"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@apollo/client";
import { InvoicesQuery, VendorsQuery } from "@/graphql/operations/queries";
import { ApproveInvoicesMutation, DeleteInvoiceMutation } from "@/graphql/operations/mutations";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable, type SortState } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { QueryState } from "@/components/ui/QueryState";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextInput, DateInput } from "@/components/ui/Field";
import { pickInvoiceColumns } from "@/components/invoice/columns";
import { DEPARTMENTS, INVOICE_SOURCES, PAGE_SIZE } from "@/lib/constants";
import { toCsv, downloadCsv } from "@/lib/csv";
import { fmtDate } from "@/lib/format";
import { useRole } from "@/lib/role";
import type { InvoiceRow } from "@/lib/types";

const COLUMNS = [
  "invoiceNumber",
  "vendor",
  "department",
  "invoiceDate",
  "dueDate",
  "amount",
  "duplicate",
  "approval",
  "payment",
];

export default function InvoicesPage() {
  return (
    <Suspense fallback={null}>
      <Invoices />
    </Suspense>
  );
}

function Invoices() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useRole();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const get = (k: string) => params.get(k) ?? "";
  const setParams = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(Array.from(params.entries()));
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (resetPage) next.delete("page");
    router.replace(next.toString() ? `/invoices?${next}` : "/invoices");
  };

  const page = Math.max(1, Number(get("page")) || 1);
  const sort: SortState = {
    field: get("sortField") || "dueDate",
    dir: (get("sortDir") as "ASC" | "DESC") || "ASC",
  };

  const filter = useMemo(
    () => ({
      vendorId: get("vendor") || null,
      department: get("department") || null,
      dateFrom: get("from") || null,
      dateTo: get("to") || null,
      approvalStatus: (get("approval") || null) as never,
      paymentStatus: (get("payment") || null) as never,
      source: get("source") || null,
      q: get("q") || null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params],
  );

  const vendors = useQuery(VendorsQuery);
  const { data, loading, error, refetch } = useQuery(InvoicesQuery, {
    variables: { filter, sort, page, pageSize: PAGE_SIZE },
  });
  const [approve, approveState] = useMutation(ApproveInvoicesMutation, {
    refetchQueries: ["Invoices", "DashboardStats"],
    awaitRefetchQueries: true,
    onError: () => {}, // shown in the selection bar via approveState.error
  });
  const [deleteInvoice] = useMutation(DeleteInvoiceMutation, { onError: () => {} });
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const rows = (data?.invoices.rows ?? []) as InvoiceRow[];
  const total = data?.invoices.total ?? 0;

  function onSortChange(field: string) {
    setParams(
      {
        sortField: field,
        sortDir: sort.field === field && sort.dir === "ASC" ? "DESC" : "ASC",
      },
      false,
    );
  }

  async function approveSelected() {
    const ids = rows
      .filter((r) => selected.has(r.id) && r.approvalStatus === "PENDING")
      .map((r) => r.id);
    if (ids.length === 0) return;
    const res = await approve({ variables: { ids } });
    if (!res.errors?.length) setSelected(new Set());
  }

  async function deleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} invoice${ids.length === 1 ? "" : "s"}? This can't be undone.`))
      return;
    setDeleting(true);
    setDeleteError(null);
    const results = await Promise.all(
      ids.map((id) => deleteInvoice({ variables: { id }, refetchQueries: [] })),
    );
    setDeleting(false);
    const failed = results.filter((r) => r.errors?.length).length;
    if (failed > 0) {
      setDeleteError(`${failed} of ${ids.length} couldn't be deleted.`);
    }
    setSelected(new Set());
    // one shared refetch after the batch, rather than one per delete
    await refetch();
  }

  function exportSelected() {
    const chosen = rows.filter((r) => selected.has(r.id));
    const csv = toCsv(
      chosen.map((r) => ({
        invoiceNumber: r.invoiceNumber,
        vendor: r.vendor?.name ?? "",
        department: r.department,
        invoiceDate: fmtDate(r.invoiceDate),
        dueDate: fmtDate(r.dueDate),
        amount: r.amount,
        taxAmount: r.taxAmount,
        total: r.amount + r.taxAmount,
        approvalStatus: r.approvalStatus,
        paymentStatus: r.paymentStatus,
        daysOverdue: r.daysOverdue,
        source: r.source,
        duplicateFlag: r.duplicateFlag ? r.duplicateFlag.reviewedStatus : "",
        delayProbability: r.delayPrediction?.delayProbability ?? "",
      })),
      [
        { key: "invoiceNumber", label: "Invoice #" },
        { key: "vendor", label: "Vendor" },
        { key: "department", label: "Department" },
        { key: "invoiceDate", label: "Invoice date" },
        { key: "dueDate", label: "Due date" },
        { key: "amount", label: "Amount" },
        { key: "taxAmount", label: "Tax" },
        { key: "total", label: "Total" },
        { key: "approvalStatus", label: "Approval" },
        { key: "paymentStatus", label: "Payment" },
        { key: "daysOverdue", label: "Days overdue" },
        { key: "source", label: "Source" },
        { key: "duplicateFlag", label: "Duplicate review" },
        { key: "delayProbability", label: "Delay probability" },
      ],
    );
    downloadCsv(`invoices-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  const activeFilterCount = ["vendor", "department", "from", "to", "approval", "payment", "source", "q"].filter(
    (k) => get(k),
  ).length;

  return (
    <>
      <PageHeader
        title="Invoices"
        meta={`${total} invoice${total === 1 ? "" : "s"}${activeFilterCount ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied` : ""}`}
      />

      <Panel className="mb-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Search">
            <TextInput
              defaultValue={get("q")}
              placeholder="Invoice # or vendor"
              onKeyDown={(e) => {
                if (e.key === "Enter") setParams({ q: (e.target as HTMLInputElement).value });
              }}
              onBlur={(e) => setParams({ q: e.target.value })}
            />
          </Field>
          <Field label="Vendor">
            <Select value={get("vendor")} onChange={(e) => setParams({ vendor: e.target.value })}>
              <option value="">All vendors</option>
              {vendors.data?.vendors.map((v) => (
                <option key={v.vendor.id} value={v.vendor.id}>
                  {v.vendor.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Department">
            <Select value={get("department")} onChange={(e) => setParams({ department: e.target.value })}>
              <option value="">All departments</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Source">
            <Select value={get("source")} onChange={(e) => setParams({ source: e.target.value })}>
              <option value="">Any source</option>
              {INVOICE_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Approval">
            <Select value={get("approval")} onChange={(e) => setParams({ approval: e.target.value })}>
              <option value="">Any approval</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
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
          <Field label="Invoiced from">
            <DateInput value={get("from")} onChange={(e) => setParams({ from: e.target.value })} className="w-full" />
          </Field>
          <Field label="Invoiced to">
            <DateInput value={get("to")} onChange={(e) => setParams({ to: e.target.value })} className="w-full" />
          </Field>
        </div>
        {activeFilterCount > 0 && (
          <div className="mt-3">
            <Button variant="ghost" onClick={() => router.replace("/invoices")}>
              Clear all filters
            </Button>
          </div>
        )}
      </Panel>

      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 border border-line bg-surface px-4 py-2.5 text-sm">
          <span className="tabular">{selected.size} selected</span>
          {can("approve") && (
            <Button
              variant="primary"
              onClick={approveSelected}
              disabled={approveState.loading}
            >
              Approve selected
            </Button>
          )}
          <Button onClick={exportSelected}>Export selected to CSV</Button>
          {can("deleteInvoice") && (
            <Button variant="danger" onClick={deleteSelected} disabled={deleting}>
              Delete selected
            </Button>
          )}
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
          {approveState.error && (
            <span className="text-bad-fg">{approveState.error.message}</span>
          )}
          {deleteError && <span className="text-bad-fg">{deleteError}</span>}
        </div>
      )}

      <QueryState loading={loading && rows.length === 0} error={error} minRows={8}>
        <DataTable
          rows={rows}
          columns={pickInvoiceColumns(COLUMNS)}
          rowId={(r) => r.id}
          rowHref={(r) => `/invoices/${r.id}`}
          sort={sort}
          onSortChange={onSortChange}
          selectable
          selectedIds={selected}
          onSelectedChange={setSelected}
          empty="No invoices match these filters."
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
