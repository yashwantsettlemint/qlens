"use client";

import { Suspense, useState } from "react";
import { useQuery } from "@apollo/client";
import { useRouter, useSearchParams } from "next/navigation";
import { VendorsQuery, InvoicesQuery } from "@/graphql/operations/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatStrip, Stat } from "@/components/ui/StatStrip";
import { QueryState } from "@/components/ui/QueryState";
import { Money } from "@/components/ui/Money";
import { VendorPaymentTimelineChart } from "@/components/VendorPaymentTimelineChart";
import {
  vendorHistoryStats,
  quarterlyTrend,
  nextBillEstimate,
  paidBills,
  signedLateness,
} from "@/lib/vendorHistory";
import { cn } from "@/lib/cn";
import { fmtDate, inrCompact } from "@/lib/format";
import type { InvoiceRow } from "@/lib/types";

export default function VendorHistoryPage() {
  return (
    <Suspense fallback={null}>
      <VendorHistory />
    </Suspense>
  );
}

function fmtDays(d: number): string {
  return d > 0 ? `+${d}d` : d < 0 ? `${d}d` : "0d";
}

function VendorHistory() {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState("");

  const vendors = useQuery(VendorsQuery);
  const rows = vendors.data?.vendors ?? [];
  const filteredRows = rows.filter((r) =>
    r.vendor.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const selectedId = params.get("vendor") ?? rows[0]?.vendor.id ?? null;
  const selected = rows.find((r) => r.vendor.id === selectedId) ?? null;

  const history = useQuery(InvoicesQuery, {
    variables: {
      filter: { vendorId: selectedId },
      sort: { field: "dueDate", dir: "DESC" },
      page: 1,
      pageSize: 500,
    },
    skip: !selectedId,
  });
  const invoices = (history.data?.invoices.rows ?? []) as InvoiceRow[];

  function selectVendor(id: string) {
    const next = new URLSearchParams(Array.from(params.entries()));
    next.set("vendor", id);
    router.replace(`/vendor-history?${next.toString()}`);
  }

  const stats = vendorHistoryStats(invoices);
  const trend = quarterlyTrend(invoices);
  const estimate = nextBillEstimate(invoices);
  const recentPayments = paidBills(invoices)
    .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())
    .slice(0, 8);

  return (
    <>
      <PageHeader
        title="Vendor payment history"
        meta="How late you have paid each vendor against their terms — and when the next bill is likely to clear."
      />

      <QueryState loading={vendors.loading && rows.length === 0} error={vendors.error} minRows={6}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
          <Panel title="Vendors" className="h-fit">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search vendors"
              className="mb-3 h-9 w-full rounded-lg border border-line bg-ground px-3 text-sm outline-none focus:border-accent"
            />
            <ul className="-mx-5 -mb-5 divide-y divide-line border-t border-line">
              {filteredRows.map((r) => {
                const active = r.vendor.id === selectedId;
                return (
                  <li key={r.vendor.id}>
                    <button
                      type="button"
                      onClick={() => selectVendor(r.vendor.id)}
                      className={cn(
                        "block w-full px-5 py-3 text-left transition-colors",
                        active ? "bg-ground" : "hover:bg-ground/60",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink">{r.vendor.name}</span>
                        <span
                          className={cn(
                            "tabular shrink-0 text-xs font-medium",
                            r.avgDelayDays > 3 ? "text-bad-fg" : r.avgDelayDays > 0 ? "text-warn-fg" : "text-ok-fg",
                          )}
                        >
                          {fmtDays(r.avgDelayDays)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-ink-muted">
                        {r.vendor.paymentTermsDays ? `Net ${r.vendor.paymentTermsDays}` : "Terms n/a"} ·{" "}
                        {r.onTimePct}% on time
                      </div>
                    </button>
                  </li>
                );
              })}
              {filteredRows.length === 0 && (
                <li className="px-5 py-4 text-sm text-ink-muted">No vendors match.</li>
              )}
            </ul>
          </Panel>

          {!selected ? (
            <p className="text-sm text-ink-muted">No vendor selected.</p>
          ) : (
            <div>
              <Panel title={selected.vendor.name} className="mb-6">
                <p className="mb-4 text-xs text-ink-muted">
                  {selected.vendor.paymentTermsDays ? `Net ${selected.vendor.paymentTermsDays} terms` : "Terms n/a"}{" "}
                  · {paidBills(invoices).length} bills paid · {selected.totalInvoices} invoices total
                </p>
                <StatStrip cols={4}>
                  <Stat
                    label="Average vs due date"
                    value={`${stats.avgVsDueDays > 0 ? "+" : ""}${stats.avgVsDueDays} days`}
                    rule={stats.avgVsDueDays > 7 ? "bad" : stats.avgVsDueDays > 0 ? "warn" : "ok"}
                  />
                  <Stat
                    label="Paid on or before due"
                    value={`${stats.onTimeOrEarlyPct}%`}
                    hint={`${paidBills(invoices).length} bills`}
                  />
                  <Stat
                    label="Longest delay"
                    value={`${stats.longestDelayDays} days`}
                    hint={stats.longestDelayInvoice ?? "—"}
                    rule={stats.longestDelayDays > 7 ? "bad" : "neutral"}
                  />
                  <Stat
                    label="Open with vendor"
                    value={inrCompact(stats.openAmount)}
                    hint={stats.openAmount === 0 ? "Paid up" : "Unpaid, incl. tax"}
                    rule={stats.openAmount === 0 ? "ok" : "neutral"}
                  />
                </StatStrip>

                <div className="mt-6">
                  <p className="mb-2 text-xs text-ink-muted">
                    Each bill: days paid after (+) or before (-) the due date.
                  </p>
                  <QueryState loading={history.loading && invoices.length === 0} error={history.error} minRows={3}>
                    <VendorPaymentTimelineChart invoices={invoices} />
                  </QueryState>
                </div>
              </Panel>

              <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Panel title="Prediction · next bill" accent>
                  {!estimate ? (
                    <p className="text-sm text-ink-muted">
                      Not enough paid history with this vendor yet to estimate.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-ink-muted">
                        Based on this vendor&apos;s own payment history (not a model prediction):
                      </p>
                      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">
                        Likely paid {estimate.windowStart}–{estimate.windowEnd} days after due
                      </p>
                      <p className="mt-1 text-sm text-ink-muted">
                        Most likely around {estimate.mostLikelyDays} day{estimate.mostLikelyDays === 1 ? "" : "s"}{" "}
                        after due.
                      </p>
                      <div className="mt-4">
                        <div className="mb-1 flex items-center justify-between text-xs text-ink-muted">
                          <span>Chance of paying late</span>
                          <span className="tabular font-medium text-ink">{estimate.lateChancePct}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-line">
                          <div
                            className="h-full rounded-full bg-warn-fg"
                            style={{ width: `${estimate.lateChancePct}%` }}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </Panel>

                <Panel title="Delay trend by quarter">
                  {trend.length === 0 ? (
                    <p className="text-sm text-ink-muted">No paid history yet.</p>
                  ) : (
                    <ul className="space-y-3">
                      {trend.map((t) => {
                        const width = Math.min(100, (Math.abs(t.avgVsDueDays) / 15) * 100);
                        return (
                          <li key={t.label} className="flex items-center gap-3">
                            <span className="w-20 shrink-0 text-xs text-ink-muted">{t.label}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  t.avgVsDueDays > 7 ? "bg-bad-fg" : t.avgVsDueDays > 0 ? "bg-warn-fg" : "bg-ok-fg",
                                )}
                                style={{ width: `${width}%` }}
                              />
                            </div>
                            <span className="tabular w-16 shrink-0 text-right text-xs font-medium text-ink">
                              {fmtDays(t.avgVsDueDays)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>
              </div>

              <Panel title="Recent payments">
                <QueryState loading={history.loading && invoices.length === 0} error={history.error} minRows={4}>
                  {recentPayments.length === 0 ? (
                    <p className="text-sm text-ink-muted">No payments recorded yet.</p>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead className="text-ink-muted">
                        <tr>
                          <th className="py-2 text-left font-medium">Bill #</th>
                          <th className="py-2 text-left font-medium">Invoice date</th>
                          <th className="py-2 text-left font-medium">Due</th>
                          <th className="py-2 text-left font-medium">Paid</th>
                          <th className="py-2 text-right font-medium">Vs due</th>
                          <th className="py-2 text-right font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentPayments.map((bill) => {
                          const days = signedLateness(bill);
                          return (
                            <tr key={bill.id} className="border-t border-line">
                              <td className="py-2">{bill.invoiceNumber}</td>
                              <td className="tabular py-2 text-ink-muted">{fmtDate(bill.invoiceDate)}</td>
                              <td className="tabular py-2 text-ink-muted">{fmtDate(bill.dueDate)}</td>
                              <td className="tabular py-2 text-ink-muted">{fmtDate(bill.paidAt)}</td>
                              <td
                                className={cn(
                                  "tabular py-2 text-right font-medium",
                                  days > 7 ? "text-bad-fg" : days > 0 ? "text-warn-fg" : "text-ok-fg",
                                )}
                              >
                                {fmtDays(days)}
                              </td>
                              <td className="py-2 text-right">
                                <Money value={bill.amount + bill.taxAmount} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </QueryState>
              </Panel>
            </div>
          )}
        </div>
      </QueryState>
    </>
  );
}
