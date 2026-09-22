"use client";

import { useQuery } from "@apollo/client";
import { CashForecastQuery, InvoicesQuery } from "@/graphql/operations/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { QueryState } from "@/components/ui/QueryState";
import { Money } from "@/components/ui/Money";
import { ForecastChart } from "@/components/ForecastChart";
import { DelayRiskChart } from "@/components/DelayRiskChart";
import { CustomerExposureDelayChart } from "@/components/CustomerExposureDelayChart";
import { inrCompact } from "@/lib/format";
import type { InvoiceRow } from "@/lib/types";

export default function ForecastPage() {
  const { data, loading, error } = useQuery(CashForecastQuery);
  const f = data?.cashForecast;
  const buckets = f?.buckets ?? [];
  const scale = Math.max(1, ...buckets.map((b) => Math.max(b.inflow, b.outflow)));

  // Delay prediction is a receivables-only concern (will the customer pay us
  // late?) — a payable just needs its due date, so ml-service never scores
  // it. `invoices` defaults to direction: PAYABLE, so this must ask explicitly.
  const unpaid = useQuery(InvoicesQuery, {
    variables: {
      filter: { direction: "RECEIVABLE", paymentStatus: "UNPAID" },
      sort: { field: "dueDate", dir: "ASC" },
      page: 1,
      pageSize: 200,
    },
  });
  const overdue = useQuery(InvoicesQuery, {
    variables: {
      filter: { direction: "RECEIVABLE", paymentStatus: "OVERDUE" },
      sort: { field: "daysOverdue", dir: "DESC" },
      page: 1,
      pageSize: 200,
    },
  });
  const openInvoices = [
    ...((unpaid.data?.invoices.rows ?? []) as InvoiceRow[]),
    ...((overdue.data?.invoices.rows ?? []) as InvoiceRow[]),
  ];

  return (
    <>
      <PageHeader
        title="Cash forecast"
        meta="Predicted receipts vs. payments, bucketed by expected settlement date (due date + model-predicted delay)."
      />

      <QueryState loading={loading && !f} error={error} minRows={4}>
        {f && (
          <>
            <Panel
              className="mb-6"
              title={`Net position over the forecast window: ${inrCompact(f.netTotal)}`}
            >
              <ForecastChart buckets={buckets} />
            </Panel>

            <Panel className="mb-6" title="Delay risk">
              <p className="mb-2 text-xs text-ink-muted">
                Open receivables, bucketed by predicted late-payment risk — the same model
                that shifts the inflow windows above off their due dates. (Payables aren&apos;t
                scored: when we pay a vendor is our own call, not a prediction.)
              </p>
              <QueryState
                loading={unpaid.loading || overdue.loading}
                error={unpaid.error ?? overdue.error}
                minRows={3}
              >
                <DelayRiskChart invoices={openInvoices} />
              </QueryState>
            </Panel>

            <Panel className="mb-6" title="Customer exposure & delay risk">
              <p className="mb-2 text-xs text-ink-muted">
                Outstanding receivable per customer, coloured by that customer&apos;s average
                predicted late-payment risk.
              </p>
              <QueryState
                loading={unpaid.loading || overdue.loading}
                error={unpaid.error ?? overdue.error}
                minRows={3}
              >
                <CustomerExposureDelayChart invoices={openInvoices} />
              </QueryState>
            </Panel>

            <Panel className="mb-6" title="By window">
              <table className="min-w-full text-sm">
                <thead className="text-ink-muted">
                  <tr>
                    <th className="py-2 text-left font-medium">Window</th>
                    <th className="py-2 text-right font-medium">Inflow</th>
                    <th className="py-2 text-right font-medium">Outflow</th>
                    <th className="py-2 text-right font-medium">Net</th>
                    <th className="w-1/3" />
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((b) => (
                    <tr key={b.label} className="border-t border-line">
                      <td className="py-2">{b.label}</td>
                      <td className="py-2 text-right tabular text-ok-fg">
                        <Money value={b.inflow} />
                      </td>
                      <td className="py-2 text-right tabular text-bad-fg">
                        <Money value={b.outflow} />
                      </td>
                      <td
                        className={`py-2 text-right tabular ${
                          b.net >= 0 ? "text-ok-fg" : "text-bad-fg"
                        }`}
                      >
                        <Money value={b.net} />
                      </td>
                      <td className="py-2 pl-4">
                        <div className="flex h-4 items-center gap-1">
                          <div
                            className="h-2 rounded-sm bg-ok/60"
                            style={{ width: `${(b.inflow / scale) * 100}%` }}
                          />
                        </div>
                        <div className="flex h-4 items-center gap-1">
                          <div
                            className="h-2 rounded-sm bg-bad/60"
                            style={{ width: `${(b.outflow / scale) * 100}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <p className="text-xs text-ink-muted">
              Green bar = expected receipts from customers; red bar = expected payments to
              vendors. Both use each invoice’s predicted delay where the model has scored it,
              otherwise the due date.
            </p>
          </>
        )}
      </QueryState>
    </>
  );
}
