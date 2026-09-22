"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@apollo/client";
import {
  VendorDetailQuery,
  DashboardStatsQuery,
  InvoicesQuery,
} from "@/graphql/operations/queries";
import { UpdateVendorEmailMutation } from "@/graphql/operations/mutations";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatStrip, Stat } from "@/components/ui/StatStrip";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field, TextInput } from "@/components/ui/Field";
import { DataTable } from "@/components/ui/DataTable";
import { QueryState } from "@/components/ui/QueryState";
import { pickInvoiceColumns } from "@/components/invoice/columns";
import { inr, inrCompact } from "@/lib/format";
import { useRole } from "@/lib/role";
import type { InvoiceRow } from "@/lib/types";

function VendorEmailPanel({
  id,
  email,
}: {
  id: string;
  email: string | null | undefined;
}) {
  const { can } = useRole();
  const [value, setValue] = useState(email ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [update, { loading }] = useMutation(UpdateVendorEmailMutation);

  if (!can("manageUsers")) {
    return (
      <Panel title="Contact email" className="mt-6">
        <p className="text-sm text-ink-muted">{email || "None on file."}</p>
      </Panel>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaved(false);
    try {
      await update({ variables: { id, email: value || null } });
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t save");
    }
  }

  return (
    <Panel title="Contact email" className="mt-6">
      <form onSubmit={submit} className="flex items-end gap-3">
        <Field label="Email" className="flex-1">
          <TextInput
            type="email"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            placeholder="ap@vendor.com"
          />
        </Field>
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? "Saving…" : "Save"}
        </Button>
      </form>
      {err && <Callout tone="bad" className="mt-3 text-xs">{err}</Callout>}
      {saved && <Callout tone="ok" className="mt-3 text-xs">Saved.</Callout>}
    </Panel>
  );
}

const HISTORY_COLUMNS = [
  "invoiceNumber",
  "department",
  "invoiceDate",
  "dueDate",
  "amount",
  "daysOverdue",
  "risk",
  "duplicate",
  "approval",
  "payment",
];

export default function VendorDetailPage({ params }: { params: { id: string } }) {
  const vendor = useQuery(VendorDetailQuery, { variables: { id: params.id } });
  const stats = useQuery(DashboardStatsQuery, { variables: { vendorId: params.id } });
  const history = useQuery(InvoicesQuery, {
    variables: {
      filter: { vendorId: params.id },
      sort: { field: "invoiceDate", dir: "DESC" },
      page: 1,
      pageSize: 500,
    },
  });

  const v = vendor.data?.vendor;
  const s = stats.data?.dashboardStats;
  const rows = (history.data?.invoices.rows ?? []) as InvoiceRow[];

  return (
    <QueryState loading={vendor.loading && !v} error={vendor.error} minRows={4}>
      {!v ? (
        <p className="text-sm text-ink-muted">Vendor not found.</p>
      ) : (
        <>
          <PageHeader
            title={v.vendor.name}
            meta={
              <span className="tabular">
                {v.vendor.taxId ?? "No GSTIN"} ·{" "}
                {v.vendor.paymentTermsDays ? `${v.vendor.paymentTermsDays}-day terms` : "terms n/a"}
              </span>
            }
          />

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
                label="Outstanding exposure"
                value={inrCompact(s.vendorExposureTotal)}
                hint="Unpaid, incl. tax"
              />
            </StatStrip>
          )}

          <div className="mt-3 grid grid-cols-1 divide-line border border-line bg-surface text-sm sm:grid-cols-3 sm:divide-x">
            <div className="px-4 py-3">
              <div className="text-xs text-ink-muted">Total invoices</div>
              <div className="tabular mt-1 text-lg">{v.totalInvoices}</div>
            </div>
            <div className="px-4 py-3">
              <div className="text-xs text-ink-muted">Avg payment delay</div>
              <div className="tabular mt-1 text-lg">{v.avgDelayDays.toFixed(1)} days</div>
            </div>
            <div className="px-4 py-3">
              <div className="text-xs text-ink-muted">Paid on time</div>
              <div className="tabular mt-1 text-lg">{v.onTimePct}%</div>
            </div>
          </div>

          <VendorEmailPanel id={params.id} email={v.vendor.email} />

          <Panel title="Invoice history" className="mt-6">
            <QueryState loading={history.loading} error={history.error} minRows={6}>
              <DataTable
                rows={rows}
                columns={pickInvoiceColumns(HISTORY_COLUMNS)}
                rowId={(r) => r.id}
                rowHref={(r) => `/invoices/${r.id}`}
                defaultSort={{ field: "invoiceDate", dir: "DESC" }}
                empty="No invoices for this vendor."
              />
            </QueryState>
          </Panel>
        </>
      )}
    </QueryState>
  );
}
