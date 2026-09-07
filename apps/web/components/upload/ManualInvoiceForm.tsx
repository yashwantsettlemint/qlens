"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@apollo/client";
import { CreateInvoiceMutation } from "@/graphql/operations/mutations";
import { Field, Select, TextInput, DateInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { DEPARTMENTS, INVOICE_SOURCES } from "@/lib/constants";
import { validateInvoiceInput } from "@/lib/validateInvoice";

interface VendorOption {
  id: string;
  name: string;
}

const empty = {
  invoiceNumber: "",
  vendorId: "",
  department: "",
  invoiceDate: "2026-09-07",
  dueDate: "",
  amount: "",
  taxAmount: "",
  source: "manual",
};

export function ManualInvoiceForm({ vendors }: { vendors: VendorOption[] }) {
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [createInvoice, { data, loading }] = useMutation(CreateInvoiceMutation, {
    refetchQueries: ["Invoices", "DashboardStats"],
  });

  const set = (k: keyof typeof empty, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = {
      ...form,
      amount: Number(form.amount),
      taxAmount: Number(form.taxAmount),
    };
    const problem = validateInvoiceInput(input, new Set(vendors.map((v) => v.id)));
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    createInvoice({ variables: { input } }).then(() => setForm(empty));
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Invoice number">
          <TextInput
            value={form.invoiceNumber}
            onChange={(e) => set("invoiceNumber", e.target.value)}
            placeholder="ACME/26-27/1099"
          />
        </Field>
        <Field label="Vendor">
          <Select value={form.vendorId} onChange={(e) => set("vendorId", e.target.value)}>
            <option value="">Select a vendor</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Department">
          <Select value={form.department} onChange={(e) => set("department", e.target.value)}>
            <option value="">Select a department</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Source">
          <Select value={form.source} onChange={(e) => set("source", e.target.value)}>
            {INVOICE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Invoice date">
          <DateInput
            value={form.invoiceDate}
            onChange={(e) => set("invoiceDate", e.target.value)}
            className="w-full"
          />
        </Field>
        <Field label="Due date">
          <DateInput
            value={form.dueDate}
            onChange={(e) => set("dueDate", e.target.value)}
            className="w-full"
          />
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
        <Field label="Tax amount (GST)">
          <TextInput
            inputMode="decimal"
            value={form.taxAmount}
            onChange={(e) => set("taxAmount", e.target.value)}
          />
        </Field>
      </div>

      {error && (
        <p className="border border-bad-fg/30 bg-bad-bg px-3 py-2 text-sm text-bad-fg">{error}</p>
      )}
      {data?.createInvoice && (
        <p className="border border-ok-fg/30 bg-ok-bg px-3 py-2 text-sm text-ok-fg">
          Created{" "}
          <Link href={`/invoices/${data.createInvoice.id}`} className="font-medium underline">
            {data.createInvoice.invoiceNumber}
          </Link>{" "}
          — it’s now pending approval.
        </p>
      )}

      <Button variant="primary" type="submit" disabled={loading}>
        Add invoice
      </Button>
    </form>
  );
}
