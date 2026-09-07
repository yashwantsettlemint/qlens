"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@apollo/client";
import {
  DashboardStatsQuery,
  VendorExposureQuery,
  InvoicesQuery,
} from "@/graphql/operations/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatStrip, Stat } from "@/components/ui/StatStrip";
import { DataTable } from "@/components/ui/DataTable";
import { Panel } from "@/components/ui/Panel";
import { QueryState } from "@/components/ui/QueryState";
import { Button } from "@/components/ui/Button";
import { ExposureBarChart } from "@/components/ExposureBarChart";
import { pickInvoiceColumns } from "@/components/invoice/columns";
import { inr, inrCompact } from "@/lib/format";
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
  const vendorId = params.get("vendor");

  const setVendor = (id: string | null) => {
    const next = new URLSearchParams(Array.from(params.entries()));
    if (id) next.set("vendor", id);
    else next.delete("vendor");
    router.replace(next.toString() ? `/?${next}` : "/");
  };

  const stats = useQuery(DashboardStatsQuery, { variables: { vendorId } });
  const exposure = useQuery(VendorExposureQuery, { variables: {} });
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
          vendorId ? (
            <Button onClick={() => setVendor(null)}>Clear vendor filter</Button>
          ) : undefined
        }
      />

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
