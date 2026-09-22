"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@apollo/client";
import { CustomersQuery } from "@/graphql/operations/queries";
import { CreateCustomerMutation } from "@/graphql/operations/mutations";
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
import type { CustomerStatsRow } from "@/lib/types";

function onTimeTone(p: number) {
  if (p >= 90) return "ok" as const;
  if (p >= 70) return "warn" as const;
  return "bad" as const;
}

const columns: Column<CustomerStatsRow>[] = [
  {
    key: "name",
    header: "Customer",
    sortable: true,
    sortValue: (r) => r.customer.name,
    cell: (r) => r.customer.name,
  },
  {
    key: "email",
    header: "Email",
    sortable: true,
    sortValue: (r) => r.customer.email ?? "",
    cell: (r) => <span className="text-xs text-ink-muted">{r.customer.email ?? "—"}</span>,
  },
  {
    key: "creditLimit",
    header: "Credit limit",
    align: "right",
    sortable: true,
    sortValue: (r) => r.customer.creditLimit ?? 0,
    cell: (r) => (r.customer.creditLimit ? <Money value={r.customer.creditLimit} /> : <span className="text-ink-muted">—</span>),
  },
  {
    key: "totalInvoices",
    header: "Receivables",
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

function AddCustomerPanel() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [taxId, setTaxId] = useState("");
  const [terms, setTerms] = useState("30");
  const [limit, setLimit] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [createCustomer, { loading }] = useMutation(CreateCustomerMutation, {
    refetchQueries: [{ query: CustomersQuery }],
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    try {
      const res = await createCustomer({
        variables: {
          name,
          email: email || null,
          taxId: taxId || null,
          paymentTermsDays: Number(terms) || 30,
          creditLimit: limit ? Number(limit) : null,
        },
      });
      setName("");
      setEmail("");
      setTaxId("");
      setTerms("30");
      setLimit("");
      setOk(`Added ${res.data?.createCustomer.name ?? name}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t add customer");
    }
  }

  return (
    <Panel title="Add customer" className="mb-6">
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-5">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
        </Field>
        <Field label="Email">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ap@customer.com"
          />
        </Field>
        <Field label="GSTIN">
          <TextInput value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Terms (days)">
          <TextInput type="number" value={terms} onChange={(e) => setTerms(e.target.value)} />
        </Field>
        <Field label="Credit limit">
          <TextInput
            type="number"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="Optional"
          />
        </Field>
        <div className="md:col-span-5 flex items-center justify-end">
          <Button type="submit" variant="primary" disabled={loading || !name}>
            {loading ? "Adding…" : "Add customer"}
          </Button>
        </div>
      </form>
      {err && <Callout tone="bad" className="mt-4 text-xs">{err}</Callout>}
      {ok && <Callout tone="ok" className="mt-4 text-xs">{ok}</Callout>}
    </Panel>
  );
}

export default function CustomersPage() {
  const { can } = useRole();
  const { data, loading, error } = useQuery(CustomersQuery);
  const rows = data?.customers ?? [];

  return (
    <>
      <PageHeader title="Customers" meta={`${rows.length} customers`} />
      {(can("manageUsers") || can("addInvoices") || can("manageSettings")) && <AddCustomerPanel />}
      <QueryState loading={loading && rows.length === 0} error={error} minRows={8}>
        <DataTable
          rows={rows}
          columns={columns}
          rowId={(r) => r.customer.id}
          rowHref={(r) => `/customers/${r.customer.id}`}
          defaultSort={{ field: "totalExposure", dir: "DESC" }}
          empty="No customers."
        />
      </QueryState>
    </>
  );
}
