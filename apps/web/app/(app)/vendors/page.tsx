"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@apollo/client";
import { VendorsQuery } from "@/graphql/operations/queries";
import { CreateVendorMutation } from "@/graphql/operations/mutations";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field, TextInput } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { QueryState } from "@/components/ui/QueryState";
import { Money } from "@/components/ui/Money";
import { Badge } from "@/components/ui/Badge";
import { useRole } from "@/lib/role";
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
    key: "email",
    header: "Email",
    sortable: true,
    sortValue: (r) => r.vendor.email ?? "",
    cell: (r) => (
      <span className="text-xs text-ink-muted">{r.vendor.email ?? "—"}</span>
    ),
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

function AddVendorPanel() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [taxId, setTaxId] = useState("");
  const [terms, setTerms] = useState("30");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [createVendor, { loading }] = useMutation(CreateVendorMutation, {
    refetchQueries: [{ query: VendorsQuery }],
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    try {
      const res = await createVendor({
        variables: {
          name,
          email: email || null,
          taxId: taxId || null,
          paymentTermsDays: Number(terms) || 30,
        },
      });
      setName("");
      setEmail("");
      setTaxId("");
      setTerms("30");
      setOk(`Added ${res.data?.createVendor.name ?? name}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t add vendor");
    }
  }

  return (
    <Panel title="Add vendor" className="mb-6">
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-4">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name" />
        </Field>
        <Field label="Email">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ap@vendor.com"
          />
        </Field>
        <Field label="GSTIN">
          <TextInput value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Payment terms (days)">
          <TextInput
            type="number"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
          />
        </Field>
        <div className="md:col-span-4 flex items-center justify-end">
          <Button type="submit" variant="primary" disabled={loading || !name}>
            {loading ? "Adding…" : "Add vendor"}
          </Button>
        </div>
      </form>
      {err && <Callout tone="bad" className="mt-4 text-xs">{err}</Callout>}
      {ok && <Callout tone="ok" className="mt-4 text-xs">{ok}</Callout>}
    </Panel>
  );
}

export default function VendorsPage() {
  const { can } = useRole();
  const { data, loading, error } = useQuery(VendorsQuery);
  const rows = data?.vendors ?? [];

  return (
    <>
      <PageHeader title="Vendors" meta={`${rows.length} vendors`} />
      {(can("manageUsers") || can("addInvoices") || can("manageSettings")) && <AddVendorPanel />}
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
