"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@apollo/client";
import {
  DashboardStatsQuery,
  VendorExposureQuery,
  InvoicesQuery,
  InflowStatsQuery,
  DemoRequestsQuery,
  CashForecastQuery,
} from "@/graphql/operations/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatStrip, Stat } from "@/components/ui/StatStrip";
import { DataTable } from "@/components/ui/DataTable";
import { Panel } from "@/components/ui/Panel";
import { QueryState } from "@/components/ui/QueryState";
import { Button } from "@/components/ui/Button";
import { ExposureBarChart } from "@/components/ExposureBarChart";
import { DelayRiskChart } from "@/components/DelayRiskChart";
import { pickInvoiceColumns } from "@/components/invoice/columns";
import { inr, inrCompact, fmtDateTime } from "@/lib/format";
import { useRole } from "@/lib/role";
import type { InvoiceRow } from "@/lib/types";

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useRole();
  const vendorId = params.get("vendor");

  const setVendor = (id: string | null) => {
    const next = new URLSearchParams(Array.from(params.entries()));
    if (id) next.set("vendor", id);
    else next.delete("vendor");
    router.replace(next.toString() ? `/dashboard?${next}` : "/dashboard");
  };

  const stats = useQuery(DashboardStatsQuery, { variables: { vendorId } });
  const inflow = useQuery(InflowStatsQuery, { variables: {} });
  const exposure = useQuery(VendorExposureQuery, { variables: {} });
  const forecast = useQuery(CashForecastQuery);
  const pending = useQuery(InvoicesQuery, {
    variables: {
      filter: { approvalStatus: "PENDING", vendorId },
      sort: { field: "amount", dir: "DESC" },
      page: 1,
      pageSize: 200,
    },
  });
  const overdue = useQuery(InvoicesQuery, {
    variables: {
      filter: { paymentStatus: "OVERDUE", vendorId },
      sort: { field: "daysOverdue", dir: "DESC" },
      page: 1,
      pageSize: 200,
    },
  });
  const demoRequests = useQuery(DemoRequestsQuery, {
    variables: { limit: 10 },
    skip: !can("viewAdminStats"),
  });

  const s = stats.data?.dashboardStats;
  const selectedVendorName = exposure.data?.vendorExposure.find(
    (v) => v.vendorId === vendorId,
  )?.vendorName;

  const pendingCols = pickInvoiceColumns([
    "invoiceNumber",
    "vendor",
    "department",
    "dueDate",
    "amount",
    "risk",
    "duplicate",
    "approval",
  ]);
  const overdueCols = pickInvoiceColumns([
    "invoiceNumber",
    "vendor",
    "department",
    "dueDate",
    "amount",
    "daysOverdue",
    "payment",
  ]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        meta={selectedVendorName ? `Filtered to ${selectedVendorName}` : "All vendors"}
        actions={
          <>
            {vendorId && <Button onClick={() => setVendor(null)}>Clear vendor filter</Button>}
            {can("addInvoices") && (
              <Link href="/invoices/create">
                <Button type="button" variant="primary">
                  Create &amp; send invoice
                </Button>
              </Link>
            )}
          </>
        }
      />

      {s && (
        <div className="mb-6 rounded-xl bg-accent p-6 text-surface">
          <StatStrip cols={3}>
            <div>
              <div className="text-sm opacity-70">Owed to you</div>
              <div className="tabular mt-1.5 text-3xl font-semibold tracking-tight">
                {inrCompact(inflow.data?.inflowStats.outstandingAmount ?? 0)}
              </div>
              <div className="mt-1 text-xs opacity-70">
                {inflow.data?.inflowStats.outstandingCount ?? 0} open invoices
              </div>
            </div>
            <div>
              <div className="text-sm opacity-70">You owe</div>
              <div className="tabular mt-1.5 text-3xl font-semibold tracking-tight">
                {inrCompact(s.vendorExposureTotal)}
              </div>
              <div className="mt-1 text-xs opacity-70">Unpaid across vendors, incl. tax</div>
            </div>
            <div>
              <div className="text-sm opacity-70">Net position</div>
              <div className="tabular mt-1.5 text-3xl font-semibold tracking-tight">
                {forecast.data ? `${forecast.data.cashForecast.netTotal >= 0 ? "+" : ""}${inrCompact(forecast.data.cashForecast.netTotal)}` : "—"}
              </div>
              <div className="mt-1 text-xs opacity-70">
                <Link href="/forecast" className="underline hover:no-underline">
                  See forecast →
                </Link>
              </div>
            </div>
          </StatStrip>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Panel title="Payables — money out" actions={<Link href="/invoices" className="text-xs font-semibold text-accent hover:underline">Vendor bills →</Link>}>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-ink-muted">Awaiting approval</div>
              <div className="tabular mt-1 text-lg">{s?.pendingCount ?? 0}</div>
              <div className="text-xs text-ink-muted">{inr(s?.pendingAmount ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">Overdue to vendors</div>
              <div className="tabular mt-1 text-lg text-bad-fg">{inrCompact(s?.overdueAmount ?? 0)}</div>
              <div className="text-xs text-ink-muted">{s?.overdueCount ?? 0} bills past due</div>
            </div>
          </div>
        </Panel>
        <Panel title="Receivables — money in" actions={<Link href="/receivables" className="text-xs font-semibold text-accent hover:underline">Receivables →</Link>}>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-ink-muted">Overdue from customers</div>
              <div className="tabular mt-1 text-lg text-bad-fg">
                {inrCompact(inflow.data?.inflowStats.overdueAmount ?? 0)}
              </div>
              <div className="text-xs text-ink-muted">{inflow.data?.inflowStats.overdueCount ?? 0} invoices past due</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">Collected, last 30 days</div>
              <div className="tabular mt-1 text-lg text-ok-fg">
                {inrCompact(inflow.data?.inflowStats.settledLast30Amount ?? 0)}
              </div>
              <div className="text-xs text-ink-muted">{inflow.data?.inflowStats.settledLast30Count ?? 0} settled</div>
            </div>
          </div>
        </Panel>
      </div>

      {(() => {
        const topVendor = [...(exposure.data?.vendorExposure ?? [])].sort((a, b) => b.outstanding - a.outstanding)[0];
        const totalVendorExposure = (exposure.data?.vendorExposure ?? []).reduce((sum, v) => sum + v.outstanding, 0);
        const noMoneySoon =
          forecast.data && forecast.data.cashForecast.buckets.slice(0, 2).every((b) => b.inflow === 0);
        const items: string[] = [];
        if (topVendor && totalVendorExposure > 0) {
          const share = Math.round((topVendor.outstanding / totalVendorExposure) * 100);
          if (share >= 40) {
            items.push(
              `${topVendor.vendorName} holds ${inrCompact(topVendor.outstanding)} — ${share}% of everything you owe.`,
            );
          }
        }
        if (noMoneySoon) {
          items.push("No money is expected in the next few days — check the forecast for when it lands.");
        }
        if ((s?.overdueCount ?? 0) > 0) {
          items.push(`${s?.overdueCount} bill${s?.overdueCount === 1 ? "" : "s"} overdue to vendors — record payments as they clear.`);
        }
        return items.length > 0 ? (
          <Panel title="Needs your attention" className="mb-6">
            <ul className="space-y-2">
              {items.map((text, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-bad-fg" />
                  {text}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null;
      })()}

      <QueryState loading={stats.loading && !s} error={stats.error} minRows={1}>
        {s && (
          <StatStrip>
            <Stat
              label="Pending invoices"
              value={s.pendingCount}
              hint={`${inr(s.pendingAmount)} awaiting approval`}
            />
            <Stat
              label="Overdue amount"
              rule="bad"
              value={inrCompact(s.overdueAmount)}
              hint={`${s.overdueCount} invoices past due`}
            />
            <Stat
              label="Vendor exposure"
              value={inrCompact(s.vendorExposureTotal)}
              hint="Total unpaid, incl. tax"
            />
          </StatStrip>
        )}
      </QueryState>

      {can("viewAdminStats") && s && (
        <div className="mt-3">
          <div className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-ink-muted">
            Admin
          </div>
          <StatStrip cols={4}>
            <Stat
              label="Approved, awaiting payment"
              value={s.approvedUnpaidCount ?? 0}
              hint={`${inr(s.approvedUnpaidAmount ?? 0)} to disburse`}
            />
            <Stat
              label="Paid (last 30 days)"
              rule="ok"
              value={s.paidLast30Count ?? 0}
              hint={inr(s.paidLast30Amount ?? 0)}
            />
            <Stat
              label="Rejected"
              rule={s.rejectedCount ? "warn" : "neutral"}
              value={s.rejectedCount ?? 0}
              hint="All time"
            />
            <Stat
              label="Avg days to pay"
              value={s.avgDaysToPay ?? 0}
              hint="Invoice date → payment"
            />
          </StatStrip>
        </div>
      )}

      {can("viewAdminStats") && (
        <Panel
          title="Demo requests"
          actions={
            <Link href="/demo-requests" className="text-xs font-semibold text-accent hover:underline">
              Review all →
            </Link>
          }
          className="mt-6"
        >
          <p className="mb-2 text-xs text-ink-muted">Submitted from the public landing page&apos;s &quot;Book a demo&quot; form.</p>
          <QueryState loading={demoRequests.loading} error={demoRequests.error} minRows={2}>
            {demoRequests.data?.demoRequests.length ? (
              <ul className="divide-y divide-line">
                {demoRequests.data.demoRequests.slice(0, 3).map((d) => (
                  <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div>
                      <div className="text-sm font-medium text-ink">
                        {d.companyName} <span className="font-normal text-ink-muted">· {d.contactName}</span>
                      </div>
                      <div className="text-xs text-ink-muted">
                        {d.workEmail}
                        {d.companySize ? ` · ${d.companySize} employees` : ""}
                      </div>
                    </div>
                    <div className="tabular text-xs text-ink-muted">{fmtDateTime(d.createdAt)}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 text-sm text-ink-muted">No demo requests yet.</p>
            )}
          </QueryState>
        </Panel>
      )}

      {inflow.data?.inflowStats && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-2xs font-medium uppercase tracking-wide text-ink-muted">
              Inflow (receivables)
            </span>
            <span className="flex gap-3 text-xs">
              <a href="/receivables" className="text-accent hover:underline">Receivables →</a>
              <a href="/forecast" className="text-accent hover:underline">Cash forecast →</a>
            </span>
          </div>
          <StatStrip cols={4}>
            <Stat
              label="Outstanding receivables"
              value={inrCompact(inflow.data.inflowStats.outstandingAmount)}
              hint={`${inflow.data.inflowStats.outstandingCount} open`}
            />
            <Stat
              label="Overdue from customers"
              rule={inflow.data.inflowStats.overdueCount ? "bad" : "neutral"}
              value={inrCompact(inflow.data.inflowStats.overdueAmount)}
              hint={`${inflow.data.inflowStats.overdueCount} past due`}
            />
            <Stat
              label="Collected (last 30 days)"
              rule="ok"
              value={inrCompact(inflow.data.inflowStats.settledLast30Amount)}
              hint={`${inflow.data.inflowStats.settledLast30Count} settled`}
            />
            <Stat
              label="Days sales outstanding"
              value={inflow.data.inflowStats.dso ?? "—"}
              hint={`${inflow.data.inflowStats.draftCount} draft · ${inflow.data.inflowStats.disputedCount} disputed`}
            />
          </StatStrip>
        </div>
      )}

      <Panel title="Vendor exposure" className="mt-6">
        <p className="mb-2 text-xs text-ink-muted">
          Outstanding balance per vendor. Select a bar to filter the tables below.
        </p>
        <QueryState loading={exposure.loading} error={exposure.error} minRows={6}>
          <ExposureBarChart
            data={exposure.data?.vendorExposure ?? []}
            selectedVendorId={vendorId}
            onSelect={setVendor}
          />
        </QueryState>
      </Panel>

      <Panel title="Delay risk" className="mt-6">
        <p className="mb-2 text-xs text-ink-muted">
          Open invoices (pending + overdue), bucketed by predicted late-payment risk.
        </p>
        <QueryState loading={pending.loading || overdue.loading} error={pending.error ?? overdue.error} minRows={3}>
          <DelayRiskChart
            invoices={[
              ...((pending.data?.invoices.rows ?? []) as InvoiceRow[]),
              ...((overdue.data?.invoices.rows ?? []) as InvoiceRow[]),
            ]}
          />
        </QueryState>
      </Panel>

      <Panel title="Pending invoices" className="mt-6">
        <QueryState loading={pending.loading} error={pending.error}>
          <DataTable
            rows={(pending.data?.invoices.rows ?? []) as InvoiceRow[]}
            columns={pendingCols}
            rowId={(r) => r.id}
            rowHref={(r) => `/invoices/${r.id}`}
            defaultSort={{ field: "amount", dir: "DESC" }}
            empty="No pending invoices."
          />
        </QueryState>
      </Panel>

      <Panel title="Overdue payments" className="mt-6">
        <QueryState loading={overdue.loading} error={overdue.error}>
          <DataTable
            rows={(overdue.data?.invoices.rows ?? []) as InvoiceRow[]}
            columns={overdueCols}
            rowId={(r) => r.id}
            rowHref={(r) => `/invoices/${r.id}`}
            defaultSort={{ field: "daysOverdue", dir: "DESC" }}
            empty="Nothing overdue."
          />
        </QueryState>
      </Panel>
    </>
  );
}
