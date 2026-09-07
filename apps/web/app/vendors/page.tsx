"use client";

import { useQuery } from "@apollo/client";
import { VendorsQuery } from "@/graphql/operations/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { QueryState } from "@/components/ui/QueryState";
import { Money } from "@/components/ui/Money";
import { Badge } from "@/components/ui/Badge";
import type { VendorStatsRow } from "@/lib/types";

function onTimeTone(p: number) {
  if (p >= 90) return "ok" as const;
  if (p >= 70) return "warn" as const;
  return "bad" as const;
}

const columns: Column<VendorStatsRow>[] = [
  {
    key: "name",
    header: "Vendor",
    sortable: true,
    sortValue: (r) => r.vendor.name,
    cell: (r) => r.vendor.name,
  },
  {
    key: "taxId",
    header: "GSTIN",
    sortable: true,
    sortValue: (r) => r.vendor.taxId ?? "",
    cell: (r) => <span className="tabular text-xs text-ink-muted">{r.vendor.taxId ?? "—"}</span>,
  },
  {
    key: "totalInvoices",
    header: "Invoices",
    align: "right",
    sortable: true,
    sortValue: (r) => r.totalInvoices,
    cell: (r) => <span className="tabular">{r.totalInvoices}</span>,
  },
  {
    key: "totalExposure",
    header: "Outstanding",
    align: "right",
    sortable: true,
    sortValue: (r) => r.totalExposure,
    cell: (r) => <Money value={r.totalExposure} />,
  },
  {
    key: "avgDelayDays",
    header: "Avg delay",
    align: "right",
    sortable: true,
    sortValue: (r) => r.avgDelayDays,
    cell: (r) => <span className="tabular">{r.avgDelayDays.toFixed(1)} d</span>,
  },
  {
    key: "onTimePct",
    header: "On-time",
    align: "right",
    sortable: true,
    sortValue: (r) => r.onTimePct,
    cell: (r) => <Badge tone={onTimeTone(r.onTimePct)}>{r.onTimePct}%</Badge>,
  },
];

export default function VendorsPage() {
  const { data, loading, error } = useQuery(VendorsQuery);
  const rows = data?.vendors ?? [];

  return (
    <>
      <PageHeader title="Vendors" meta={`${rows.length} vendors`} />
      <QueryState loading={loading && rows.length === 0} error={error} minRows={8}>
        <DataTable
          rows={rows}
          columns={columns}
          rowId={(r) => r.vendor.id}
          rowHref={(r) => `/vendors/${r.vendor.id}`}
          defaultSort={{ field: "totalExposure", dir: "DESC" }}
          empty="No vendors."
        />
      </QueryState>
    </>
  );
}
