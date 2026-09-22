"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@apollo/client";
import { InvoicesQuery, CustomersQuery } from "@/graphql/operations/queries";
import { CreateInvoiceMutation, DeleteInvoiceMutation } from "@/graphql/operations/mutations";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable, type SortState } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { QueryState } from "@/components/ui/QueryState";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field, Select, TextInput, DateInput } from "@/components/ui/Field";
import { pickInvoiceColumns } from "@/components/invoice/columns";
import { PAGE_SIZE } from "@/lib/constants";
import { useRole } from "@/lib/role";
import type { InvoiceRow } from "@/lib/types";

function NewReceivablePanel({
  customers,
}: {
  customers: { id: string; name: string }[];
}) {
  const empty = {
    customerId: "",
    invoiceNumber: "",
    description: "",
    invoiceDate: "2026-09-09",
    dueDate: "",
    amount: "",
    taxAmount: "",
  };
  const [form, setForm] = useState(empty);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const set = (k: keyof typeof empty, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [create, { loading }] = useMutation(CreateInvoiceMutation, {
    refetchQueries: ["Invoices", "InflowStats", "Customers"],
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    try {
      const res = await create({
        variables: {
          input: {
            direction: "RECEIVABLE" as never,
            customerId: form.customerId,
            invoiceNumber: form.invoiceNumber,
            description: form.description || null,
            invoiceDate: form.invoiceDate,
            dueDate: form.dueDate,
            amount: Number(form.amount),
            taxAmount: Number(form.taxAmount || 0),
            department: "Sales",
            source: "manual",
          } as never,
        },
      });
      setForm(empty);
      setOk(`Created ${res.data?.createInvoice.invoiceNumber ?? form.invoiceNumber}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t create receivable");
    }
  }

  return (
    <Panel title="New receivable" className="mb-4">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-3">
        <Field label="Customer">
          <Select value={form.customerId} onChange={(e) => set("customerId", e.target.value)}>
            <option value="">Select a customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Invoice number">
          <TextInput
            value={form.invoiceNumber}
            onChange={(e) => set("invoiceNumber", e.target.value)}
            placeholder="AR/26-27/0009"
          />
        </Field>
        <Field label="Summary">
          <TextInput
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What it's for"
          />
        </Field>
        <Field label="Invoice date">
          <DateInput value={form.invoiceDate} onChange={(e) => set("invoiceDate", e.target.value)} className="w-full" />
        </Field>
        <Field label="Due date">
          <DateInput value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} className="w-full" />
        </Field>
        <Field label="Amount (excl. tax)">
          <TextInput
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => {
              set("amount", e.target.value);
              if (!form.taxAmount || form.taxAmount === "0")
                set("taxAmount", String(Math.round(Number(e.target.value) * 0.18 * 100) / 100));
            }}
          />
        </Field>
        <Field label="Tax (GST)">
          <TextInput
            inputMode="decimal"
            value={form.taxAmount}
            onChange={(e) => set("taxAmount", e.target.value)}
          />
        </Field>
        <div className="md:col-span-3 flex justify-end">
          <Button
            type="submit"
            variant="primary"
            disabled={loading || !form.customerId || !form.invoiceNumber || !form.amount || !form.dueDate}
          >
            {loading ? "Creating…" : "Create receivable"}
          </Button>
        </div>
      </form>
      {err && <Callout tone="bad" className="mt-3 text-xs">{err}</Callout>}
      {ok && <Callout tone="ok" className="mt-3 text-xs">{ok}</Callout>}
    </Panel>
  );
}

const COLUMNS = [
  "invoiceNumber",
  "customer",
  "invoiceDate",
  "dueDate",
  "amount",
  "daysOverdue",
  "collection",
  "risk",
  "payment",
];

export default function ReceivablesPage() {
  return (
    <Suspense fallback={null}>
      <Receivables />
    </Suspense>
  );
}

function Receivables() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useRole();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const get = (k: string) => params.get(k) ?? "";
  const setParams = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(Array.from(params.entries()));
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (resetPage) next.delete("page");
    router.replace(next.toString() ? `/receivables?${next}` : "/receivables");
  };

  const page = Math.max(1, Number(get("page")) || 1);
  const sort: SortState = {
    field: get("sortField") || "dueDate",
    dir: (get("sortDir") as "ASC" | "DESC") || "ASC",
  };

  const filter = useMemo(
    () => ({
      direction: "RECEIVABLE" as const,
      customerId: get("customer") || null,
      collectionStatus: (get("collection") || null) as never,
      paymentStatus: (get("payment") || null) as never,
      q: get("q") || null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params],
  );

  const customers = useQuery(CustomersQuery);
  const { data, loading, error, refetch } = useQuery(InvoicesQuery, {
    variables: { filter, sort, page, pageSize: PAGE_SIZE },
  });
  const [deleteInvoice] = useMutation(DeleteInvoiceMutation, { onError: () => {} });

  const rows = (data?.invoices.rows ?? []) as InvoiceRow[];
  const total = data?.invoices.total ?? 0;

  function onSortChange(field: string) {
    setParams(
      { sortField: field, sortDir: sort.field === field && sort.dir === "ASC" ? "DESC" : "ASC" },
      false,
    );
  }

  async function deleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} receivable${ids.length === 1 ? "" : "s"}? This can't be undone.`))
      return;
    setDeleting(true);
    setDeleteError(null);
    const results = await Promise.all(
      ids.map((id) => deleteInvoice({ variables: { id }, refetchQueries: [] })),
    );
    setDeleting(false);
    const failed = results.filter((r) => r.errors?.length).length;
    if (failed > 0) setDeleteError(`${failed} of ${ids.length} couldn't be deleted.`);
    setSelected(new Set());
    await refetch();
  }

  const activeFilters = ["customer", "collection", "payment", "q"].filter((k) => get(k)).length;

  return (
    <>
      <PageHeader
        title="Receivables"
        meta={`${total} receivable${total === 1 ? "" : "s"}${
          activeFilters ? ` · ${activeFilters} filter${activeFilters === 1 ? "" : "s"}` : ""
        }`}
        actions={
          can("addInvoices") ? (
            <Link href="/invoices/create">
              <Button type="button" variant="primary">
                Create &amp; send invoice
              </Button>
            </Link>
          ) : undefined
        }
      />

      {can("addInvoices") && (
        <NewReceivablePanel
          customers={(customers.data?.customers ?? []).map((c) => c.customer)}
        />
      )}

      <Panel className="mb-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Search">
            <TextInput
              defaultValue={get("q")}
              placeholder="Invoice # or customer"
              onKeyDown={(e) => {
                if (e.key === "Enter") setParams({ q: (e.target as HTMLInputElement).value });
              }}
              onBlur={(e) => setParams({ q: e.target.value })}
            />
          </Field>
          <Field label="Customer">
            <Select value={get("customer")} onChange={(e) => setParams({ customer: e.target.value })}>
              <option value="">All customers</option>
              {customers.data?.customers.map((c) => (
                <option key={c.customer.id} value={c.customer.id}>
                  {c.customer.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Collection">
            <Select value={get("collection")} onChange={(e) => setParams({ collection: e.target.value })}>
              <option value="">Any stage</option>
              <option value="DRAFT">Draft</option>
              <option value="SENT">Sent</option>
              <option value="DISPUTED">Disputed</option>
              <option value="SETTLED">Settled</option>
            </Select>
          </Field>
          <Field label="Payment">
            <Select value={get("payment")} onChange={(e) => setParams({ payment: e.target.value })}>
              <option value="">Any payment</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PAID">Paid</option>
              <option value="OVERDUE">Overdue</option>
            </Select>
          </Field>
        </div>
        {activeFilters > 0 && (
          <div className="mt-3">
            <Button variant="ghost" onClick={() => router.replace("/receivables")}>
              Clear all filters
            </Button>
          </div>
        )}
      </Panel>

      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 border border-line bg-surface px-4 py-2.5 text-sm">
          <span className="tabular">{selected.size} selected</span>
          {can("deleteInvoice") && (
            <Button variant="danger" onClick={deleteSelected} disabled={deleting}>
              Delete selected
            </Button>
          )}
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
          {deleteError && <span className="text-bad-fg">{deleteError}</span>}
        </div>
      )}

      <QueryState loading={loading && rows.length === 0} error={error} minRows={8}>
        <DataTable
          rows={rows}
          columns={pickInvoiceColumns(COLUMNS)}
          rowId={(r) => r.id}
          rowHref={(r) => `/receivables/${r.id}`}
          sort={sort}
          onSortChange={onSortChange}
          selectable
          selectedIds={selected}
          onSelectedChange={setSelected}
          empty="No receivables match these filters."
        />
      </QueryState>
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPage={(p) => setParams({ page: String(p) }, false)}
      />
    </>
  );
}
