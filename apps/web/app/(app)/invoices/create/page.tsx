"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@apollo/client";
import { CustomersQuery, CompanySettingsQuery } from "@/graphql/operations/queries";
import { GenerateAndSendInvoiceMutation, UpdateCustomerTaxDetailsMutation } from "@/graphql/operations/mutations";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field, Select, TextInput, DateInput } from "@/components/ui/Field";
import { TemplatePicker, type Template } from "@/components/invoice/TemplatePicker";
import { LineItemsEditor, emptyLineItem, type LineItem } from "@/components/invoice/LineItemsEditor";
import type { InvoiceDocumentData } from "@/lib/pdf/InvoiceDocument";
import { splitTax } from "@/lib/pdf/gst";

const LivePreview = dynamic(() => import("@/components/invoice/LivePreview").then((m) => m.LivePreview), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-xs text-ink-muted">Loading preview…</div>,
});

const today = new Date().toISOString().slice(0, 10);
const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

const randomInvoiceNumber = () => `INV-${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;

export default function CreateInvoicePage() {
  const router = useRouter();
  const { data: customersData } = useQuery(CustomersQuery);
  const { data: settingsData } = useQuery(CompanySettingsQuery);
  const [generate, { loading }] = useMutation(GenerateAndSendInvoiceMutation);
  const [updateCustomerTax] = useMutation(UpdateCustomerTaxDetailsMutation);

  const customers = (customersData?.customers ?? []).map((c) => c.customer);

  const [template, setTemplate] = useState<Template>("classic");
  const [customerId, setCustomerId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState(randomInvoiceNumber);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(in30);
  const [notes, setNotes] = useState("");
  const [buyerOrderNo, setBuyerOrderNo] = useState("");
  const [ackNo, setAckNo] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [buyerGstin, setBuyerGstin] = useState("");
  const [buyerState, setBuyerState] = useState("");
  const [items, setItems] = useState<LineItem[]>([emptyLineItem()]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const hasSignature = Boolean(settingsData?.companySettings.signatureDataUrl);

  function cleanLineItems() {
    return items
      .filter((it) => it.description.trim() && Number(it.quantity) > 0)
      .map((it) => ({
        description: it.description.trim(),
        note: it.note.trim() || null,
        quantity: Number(it.quantity),
        unit: it.unit || "Units",
        hsnSac: it.hsnSac.trim() || null,
        gstRate: it.gstRate ? Number(it.gstRate) : null,
        unitPrice: Number(it.unitPrice) || 0,
      }));
  }

  const selectedCustomer = customers.find((c) => c.id === customerId);

  // Autofill buyer details from the customer's saved record when a customer
  // is picked — manual edits below (e.g. a brand-new customer with nothing
  // on file yet) are saved back to the customer on submit, so next time
  // they're picked this happens automatically.
  useEffect(() => {
    setBuyerAddress(selectedCustomer?.address ?? "");
    setBuyerGstin(selectedCustomer?.gstin ?? "");
    setBuyerState(selectedCustomer?.state ?? "");
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const previewData: InvoiceDocumentData = useMemo(() => {
    const cs = settingsData?.companySettings;
    const cleanItems = cleanLineItems();
    const subtotal = cleanItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
    const company = {
      name: cs?.name || "Your company",
      gstin: cs?.gstin ?? null,
      pan: cs?.pan ?? null,
      address: cs?.address ?? null,
      state: cs?.state ?? null,
      logoDataUrl: cs?.logoDataUrl ?? null,
      bank: cs?.bankAccountNumber
        ? {
            accountName: cs.bankAccountName ?? null,
            bankName: cs.bankName ?? null,
            accountNumber: cs.bankAccountNumber,
            ifsc: cs.bankIfsc ?? null,
            swift: cs.bankSwift ?? null,
          }
        : null,
    };
    const customer = {
      name: selectedCustomer?.name ?? "(no customer selected)",
      email: selectedCustomer?.email ?? null,
      gstin: buyerGstin.trim() || null,
      pan: selectedCustomer?.taxId ?? null,
      address: buyerAddress.trim() || null,
      state: buyerState.trim() || null,
    };
    const gst = splitTax(
      cleanItems.map((li) => ({ hsnSac: li.hsnSac, gstRate: li.gstRate, taxableValue: li.quantity * li.unitPrice })),
      company.state,
      customer.state,
    );
    return {
      template,
      invoiceNumber: invoiceNumber || "PREVIEW",
      invoiceDate,
      dueDate,
      notes: notes.trim() || null,
      buyerOrderNo: buyerOrderNo.trim() || null,
      ackNo: ackNo.trim() || null,
      company,
      customer,
      lineItems: cleanItems,
      subtotal,
      tax: gst.totalTax,
      total: subtotal + gst.totalTax,
      signatureDataUrl: cs?.signatureDataUrl ?? null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, invoiceNumber, invoiceDate, dueDate, notes, buyerOrderNo, ackNo, items, selectedCustomer, buyerGstin, buyerAddress, buyerState, settingsData]);

  const deferredPreviewData = useDeferredValue(previewData);

  /** Same document the preview pane renders, straight to a file — no server. */
  async function downloadPdf() {
    setError(null);
    if (!previewData.lineItems.length) return setError("Add at least one line item");
    setPreviewing(true);
    try {
      // Both dynamic: keeps react-pdf out of this page's initial bundle,
      // same reason LivePreview is loaded with next/dynamic.
      const [{ pdf }, { InvoiceDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/lib/pdf/InvoiceDocument"),
      ]);
      const blob = await pdf(InvoiceDocument(previewData) as any).toBlob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${invoiceNumber || "invoice"}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't render the PDF");
    } finally {
      setPreviewing(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanItems = cleanLineItems();
    if (!customerId) return setError("Pick a customer");
    if (!cleanItems.length) return setError("Add at least one line item");

    try {
      // Persist any manual buyer-details edits back to the customer record
      // first, so next time this customer is picked they're autofilled.
      if (
        buyerAddress.trim() !== (selectedCustomer?.address ?? "") ||
        buyerGstin.trim() !== (selectedCustomer?.gstin ?? "") ||
        buyerState.trim() !== (selectedCustomer?.state ?? "")
      ) {
        await updateCustomerTax({
          variables: {
            id: customerId,
            gstin: buyerGstin.trim() || null,
            address: buyerAddress.trim() || null,
            state: buyerState.trim() || null,
          },
        });
      }

      const res = await generate({
        variables: {
          input: {
            customerId,
            invoiceNumber,
            invoiceDate,
            dueDate,
            notes: notes.trim() || null,
            buyerOrderNo: buyerOrderNo.trim() || null,
            ackNo: ackNo.trim() || null,
            template,
            lineItems: cleanItems,
          },
        },
      });
      const number = res.data?.generateAndSendInvoice.invoiceNumber ?? invoiceNumber;
      setSuccess(`Invoice ${number} created and sent.`);
      setTimeout(() => router.push("/receivables"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the invoice");
    }
  }

  return (
    <>
      <PageHeader title="Create & send invoice" meta="Pick a template, add line items, and email it to a customer." />

      {!hasSignature && (
        <Callout tone="warn" className="mb-4 text-xs">
          No signature saved yet — the invoice will send without one. Add one in{" "}
          <a href="/settings" className="font-medium underline">
            Settings
          </a>
          .
        </Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_440px]">
        <form onSubmit={submit} className="space-y-4">
          <Panel title="Template">
            <TemplatePicker value={template} onChange={setTemplate} />
          </Panel>

          <Panel title="Details">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Customer">
                <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Select a customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Invoice number">
                <TextInput value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
              </Field>
              <Field label="Invoice date">
                <DateInput value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </Field>
              <Field label="Due date">
                <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            </div>
            <Field label="What it's for" className="mt-4">
              <TextInput
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Consulting retainer, March 2026"
              />
            </Field>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Buyer's order no.">
                <TextInput value={buyerOrderNo} onChange={(e) => setBuyerOrderNo(e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Ack no.">
                <TextInput value={ackNo} onChange={(e) => setAckNo(e.target.value)} placeholder="Optional" />
              </Field>
            </div>
          </Panel>

          <Panel title="Buyer details">
            <p className="mb-3 text-xs text-ink-muted">
              Autofilled from the customer's saved record — edit here for a one-off change, or to fill
              in a new customer that doesn't have these on file yet. Edits are saved back to the
              customer when you send.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Address" className="md:col-span-2">
                <TextInput value={buyerAddress} onChange={(e) => setBuyerAddress(e.target.value)} placeholder="Street, city, PIN" />
              </Field>
              <Field label="GSTIN">
                <TextInput value={buyerGstin} onChange={(e) => setBuyerGstin(e.target.value)} placeholder="27AABCU1234D1Z2" />
              </Field>
              <Field label="State">
                <TextInput value={buyerState} onChange={(e) => setBuyerState(e.target.value)} placeholder="Maharashtra" />
              </Field>
            </div>
          </Panel>

          <Panel title="Line items">
            <LineItemsEditor items={items} onChange={setItems} />
          </Panel>

          {error && <Callout tone="bad" className="text-xs">{error}</Callout>}
          {success && <Callout tone="ok" className="text-xs">{success}</Callout>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="default" onClick={downloadPdf} disabled={previewing || loading}>
              {previewing ? "Rendering…" : "Download PDF"}
            </Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? "Creating & sending…" : "Generate & send"}
            </Button>
          </div>
        </form>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-ink-muted">Live preview</div>
          <div className="h-[600px] overflow-hidden rounded-lg border border-line bg-white">
            <LivePreview data={deferredPreviewData} />
          </div>
        </div>
      </div>
    </>
  );
}
