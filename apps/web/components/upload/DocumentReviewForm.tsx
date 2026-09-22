"use client";

import { useState } from "react";
import { useMutation } from "@apollo/client";
import { CreateInvoiceMutation, CreateVendorMutation, CreateCustomerMutation } from "@/graphql/operations/mutations";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Badge } from "@/components/ui/Badge";
import { TextInput, DateInput, Select } from "@/components/ui/Field";
import { inr, daysBetween } from "@/lib/format";
import { DEPARTMENTS } from "@/lib/constants";
import { validateInvoiceInput } from "@/lib/validateInvoice";

export interface PartyOption {
  id: string;
  name: string;
  paymentTermsDays?: number | null;
}

type Direction = "PAYABLE" | "RECEIVABLE";

export interface OcrResult {
  extracted_fields: Record<string, any>;
  source_map: { page: number; method: "direct" | "ocr"; confidence: number }[];
  full_text?: string;
  possible_duplicate?: {
    id: string;
    invoice_number: string;
    invoice_date: string | null;
    amount: number | null;
    vendor_name: string | null;
  } | null;
  direction: "payable" | "receivable";
  counterparty_name: string | null;
  direction_detected: boolean;
  valid: boolean;
  issues: string[];
  review_queue_id: string | null;
}

/** invoice_date + N days -> ISO date (UTC, so date-only values don't drift). */
function addDays(iso: string, n: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || !Number.isFinite(n)) return "";
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const confTone = (c: number): "ok" | "warn" | "bad" =>
  c >= 0.92 ? "ok" : c >= 0.8 ? "warn" : "bad";

/** Labelled field with an "extracted N%" confidence hint. */
function FieldRow({
  label,
  conf,
  children,
}: {
  label: string;
  conf?: number;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs text-ink-muted">
        {label}
        {conf != null && conf > 0 && (
          <Badge tone={confTone(conf)}>read {Math.round(conf * 100)}%</Badge>
        )}
      </span>
      {children}
    </label>
  );
}

const DEFAULT_TERMS = 30;

/** The extracted-fields review/edit/commit form. Shared by the interactive
 * single-document OCR upload (DocumentUpload — a fresh /extract result) and
 * the Review Queue (a stored draft from a bulk upload). Seeds its state once
 * from `result`/`filename`; the parent remounts it (unmount on null result,
 * or a `key` per draft) to reset between documents rather than this component
 * reacting to prop changes mid-life. */
export function DocumentReviewForm({
  result,
  filename,
  vendors,
  customers,
  onCommitted,
}: {
  result: OcrResult;
  filename: string | null;
  vendors: PartyOption[];
  customers: PartyOption[];
  onCommitted?: (invoiceId: string, invoiceNumber: string) => void;
}) {
  const f = result.extracted_fields ?? {};
  const confs: Record<string, number> = f.field_confidences ?? {};

  const initialDirection: Direction = result.direction === "receivable" ? "RECEIVABLE" : "PAYABLE";
  const initialParties = initialDirection === "RECEIVABLE" ? customers : vendors;

  function matchParty(dir: Direction, counterpartyName: string | null | undefined) {
    const list = dir === "RECEIVABLE" ? customers : vendors;
    const readName = String(counterpartyName ?? "").trim();
    return list.find((v) => v.name.trim().toLowerCase() === readName.toLowerCase());
  }
  const initialMatch = matchParty(initialDirection, result.counterparty_name);

  const invDate = f.invoice_date != null ? String(f.invoice_date) : "";
  const dueRead = f.due_date != null ? String(f.due_date) : "";

  const [form, setForm] = useState({
    invoiceNumber: f.invoice_number != null ? String(f.invoice_number) : "",
    invoiceDate: invDate,
    amount: f.amount != null ? String(f.amount) : "",
    taxAmount: f.tax_amount != null ? String(f.tax_amount) : "",
  });
  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [partyId, setPartyId] = useState(initialMatch?.id ?? "");
  const [department, setDepartment] = useState("");
  const [commitErr, setCommitErr] = useState<string | null>(null);
  // True for the whole commit (including auto-creating a new party first), not
  // just the createInvoice call — otherwise a double-click during that gap can
  // create two vendors/customers and two invoices.
  const [submitting, setSubmitting] = useState(false);
  const [newParty, setNewParty] = useState(initialMatch ? "" : String(result.counterparty_name ?? "").trim());
  const [newPartyTerms, setNewPartyTerms] = useState("");
  const [dueOverride, setDueOverride] = useState(dueRead);
  const [terms, setTerms] = useState(
    dueRead
      ? String(Math.max(daysBetween(dueRead, invDate), 0))
      : String(initialMatch?.paymentTermsDays ?? DEFAULT_TERMS),
  );

  const parties = direction === "RECEIVABLE" ? customers : vendors;
  const partyLabel = direction === "RECEIVABLE" ? "Customer" : "Vendor";

  // Due date = invoice date + payment terms, unless the reader gave a due date
  // or the user typed one (dueOverride). `terms` is editable when neither is known.
  const effectiveDue =
    dueOverride ||
    (form.invoiceDate && terms.trim() !== "" ? addDays(form.invoiceDate, Number(terms)) : "");

  const [createInvoice, { data: created, error: commitMutErr }] = useMutation(
    CreateInvoiceMutation,
    { refetchQueries: ["Invoices", "DashboardStats"], awaitRefetchQueries: true, onError: () => {} },
  );
  const [createVendor, { loading: addingVendor, error: vendorErr }] = useMutation(
    CreateVendorMutation,
    { refetchQueries: ["Vendors"], awaitRefetchQueries: true, onError: () => {} },
  );
  const [createCustomer, { loading: addingCustomer, error: customerErr }] = useMutation(
    CreateCustomerMutation,
    { refetchQueries: ["Customers"], awaitRefetchQueries: true, onError: () => {} },
  );
  const addingParty = direction === "RECEIVABLE" ? addingCustomer : addingVendor;
  const partyErr = direction === "RECEIVABLE" ? customerErr : vendorErr;

  /** Creates the typed new party and returns its id, or undefined on failure. */
  async function ensureParty(): Promise<string | undefined> {
    const nm = newParty.trim();
    if (!nm) return undefined;
    const t = Number(newPartyTerms);
    const termsVal = Number.isFinite(t) && t > 0 ? t : undefined;
    let id: string | undefined;
    if (direction === "RECEIVABLE") {
      id = (await createCustomer({ variables: { name: nm, paymentTermsDays: termsVal } })).data?.createCustomer?.id;
    } else {
      id = (await createVendor({ variables: { name: nm, paymentTermsDays: termsVal } })).data?.createVendor?.id;
    }
    if (!id) return undefined;
    setPartyId(id);
    setNewParty("");
    if (termsVal && !dueOverride) setTerms(String(termsVal));
    return id;
  }

  function addParty() {
    void ensureParty();
  }

  function pickParty(id: string) {
    setPartyId(id);
    if (!dueOverride) {
      const p = parties.find((x) => x.id === id);
      if (p?.paymentTermsDays != null) setTerms(String(p.paymentTermsDays));
    }
  }

  const set = (k: keyof typeof form, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  function switchDirection(dir: Direction) {
    // Manual correction, e.g. the AI guess was wrong: re-run the name match
    // against the other party list, using whichever name that list represents.
    const counterpartyName = dir === "RECEIVABLE" ? f.buyer_name : f.vendor_name;
    const match = matchParty(dir, counterpartyName ?? result.counterparty_name);
    setDirection(dir);
    setPartyId(match?.id ?? "");
    setNewParty(match ? "" : String(counterpartyName ?? result.counterparty_name ?? "").trim());
  }

  async function commit() {
    if (submitting) return; // already in flight — ignore a double-click
    setSubmitting(true);
    try {
      // A typed-but-not-yet-added new party: create it now instead of making
      // the user click "Add vendor"/"Add customer" separately before they can commit.
      let id = partyId;
      if (!id && newParty.trim()) {
        setCommitErr(null);
        id = (await ensureParty()) ?? "";
        if (!id) {
          setCommitErr(`Couldn't add ${partyLabel.toLowerCase()} "${newParty.trim()}" — try again.`);
          return;
        }
      }

      const input = {
        invoiceNumber: form.invoiceNumber.trim(),
        direction,
        invoiceDate: form.invoiceDate.trim(),
        dueDate: effectiveDue.trim(),
        amount: Number(form.amount),
        taxAmount: Number(form.taxAmount || 0),
        department,
        source: "ocr",
        extractedText: result.full_text || undefined,
        ...(direction === "RECEIVABLE" ? { customerId: id } : { vendorId: id }),
      };
      const problem = validateInvoiceInput(input, new Set([...parties.map((v) => v.id), id]));
      if (problem) {
        setCommitErr(problem);
        return;
      }
      setCommitErr(null);
      const res = await createInvoice({ variables: { input } });
      const invoice = res.data?.createInvoice;
      if (!res.errors?.length && invoice) {
        onCommitted?.(invoice.id, invoice.invoiceNumber);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
      {filename && <div className="tabular text-xs text-ink-muted">{filename}</div>}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {result.source_map.map((s) => (
          <span
            key={s.page}
            className="rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 text-ink-muted"
          >
            page {s.page} · {s.method}
            {s.method === "ocr" && ` ${Math.round(s.confidence * 100)}%`}
          </span>
        ))}
      </div>

      {result.possible_duplicate && (
        <Callout tone="dup">
          <span className="font-medium">Already in the system</span> — invoice{" "}
          <span className="tabular">{result.possible_duplicate.invoice_number}</span>
          {result.possible_duplicate.vendor_name && ` for ${result.possible_duplicate.vendor_name}`}
          {result.possible_duplicate.amount != null &&
            `, ${inr(result.possible_duplicate.amount)}`}
          {result.possible_duplicate.invoice_date &&
            `, dated ${result.possible_duplicate.invoice_date}`}
          . A duplicate can&rsquo;t be committed.
        </Callout>
      )}

      {!result.valid && !result.possible_duplicate && (
        <Callout tone="warn">
          Low-confidence read — check every field before committing.
          {result.review_queue_id && (
            <span className="text-xs">
              {" "}
              Also saved to the review queue (
              <span className="tabular">{result.review_queue_id.slice(0, 8)}</span>).
            </span>
          )}
        </Callout>
      )}

      {!result.direction_detected && (
        <Callout tone="warn">
          Couldn&rsquo;t tell payable from receivable automatically — set your company name in{" "}
          <strong>Settings</strong> to auto-detect next time. Defaulted to payable; correct it
          below if that&rsquo;s wrong.
        </Callout>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <FieldRow label="Direction">
          <Select
            value={direction}
            onChange={(e) => switchDirection(e.target.value as Direction)}
            className="w-full"
          >
            <option value="PAYABLE">Payable — you owe this</option>
            <option value="RECEIVABLE">Receivable — you&rsquo;re owed this</option>
          </Select>
          {result.direction_detected && (
            <span className="mt-0.5 block text-2xs text-ink-muted">
              auto-detected from your company name
            </span>
          )}
        </FieldRow>
        <FieldRow label="Invoice #" conf={confs.invoice_number}>
          <TextInput
            value={form.invoiceNumber}
            onChange={(e) => set("invoiceNumber", e.target.value)}
            className="w-full"
          />
        </FieldRow>
        <FieldRow
          label={partyLabel}
          conf={direction === "RECEIVABLE" ? confs.buyer_name : confs.vendor_name}
        >
          <Select value={partyId} onChange={(e) => pickParty(e.target.value)} className="w-full">
            <option value="">
              {newParty
                ? `Read "${newParty}" — add below or pick one`
                : parties.length === 0
                  ? `No ${partyLabel.toLowerCase()}s yet — add one below`
                  : `Select a ${partyLabel.toLowerCase()}`}
            </option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          {!partyId && (
            <div className="mt-1.5 flex gap-2">
              <TextInput
                value={newParty}
                onChange={(e) => setNewParty(e.target.value)}
                placeholder={`New ${partyLabel.toLowerCase()} name`}
                className="w-full"
              />
              <TextInput
                inputMode="numeric"
                value={newPartyTerms}
                onChange={(e) => setNewPartyTerms(e.target.value)}
                placeholder="terms (days)"
                className="w-28 shrink-0"
              />
              <Button type="button" disabled={addingParty || !newParty.trim()} onClick={addParty}>
                Add {partyLabel.toLowerCase()}
              </Button>
            </div>
          )}
          {partyErr && <p className="mt-1 text-xs text-bad-fg">{partyErr.message}</p>}
        </FieldRow>
        <FieldRow label="Department">
          <Select value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full">
            <option value="">Select a department</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </FieldRow>
        <FieldRow label="Invoice date" conf={confs.invoice_date}>
          <DateInput
            value={form.invoiceDate}
            onChange={(e) => set("invoiceDate", e.target.value)}
            className="w-full"
          />
        </FieldRow>
        <FieldRow label="Payment terms (days)">
          <TextInput
            inputMode="numeric"
            value={terms}
            onChange={(e) => {
              setTerms(e.target.value);
              setDueOverride(""); // back to derived
            }}
            placeholder="e.g. 30"
            className="w-full"
          />
        </FieldRow>
        <FieldRow label="Due date" conf={confs.due_date}>
          <DateInput value={effectiveDue} onChange={(e) => setDueOverride(e.target.value)} className="w-full" />
          {!dueOverride && effectiveDue && (
            <span className="mt-0.5 block text-2xs text-ink-muted">
              invoice date + {terms || 0} days
            </span>
          )}
        </FieldRow>
        <FieldRow label="Source">
          <TextInput value="ocr" disabled className="w-full" />
        </FieldRow>
        <FieldRow label="Amount (excl. tax)" conf={confs.amount}>
          <TextInput
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => set("amount", e.target.value)}
            className="w-full"
          />
        </FieldRow>
        <FieldRow label="Tax" conf={confs.tax_amount}>
          <TextInput
            inputMode="decimal"
            value={form.taxAmount}
            onChange={(e) => set("taxAmount", e.target.value)}
            className="w-full"
          />
        </FieldRow>
      </div>

      {result.full_text && (
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-muted hover:text-ink">
            Extracted text ({result.full_text.length} chars)
          </summary>
          <pre className="tabular mt-1.5 max-h-56 overflow-auto rounded-lg border border-line bg-surface-2 p-2.5 whitespace-pre-wrap">
            {result.full_text}
          </pre>
        </details>
      )}

      {commitErr && <Callout tone="bad">{commitErr}</Callout>}
      {commitMutErr && <Callout tone="bad">{commitMutErr.message}</Callout>}
      {created?.createInvoice ? (
        <Callout tone="ok">
          Committed <span className="tabular">{created.createInvoice.invoiceNumber}</span>.
        </Callout>
      ) : (
        <Button variant="primary" disabled={submitting || Boolean(result.possible_duplicate)} onClick={commit}>
          {submitting ? "Committing…" : "Commit invoice"}
        </Button>
      )}
    </div>
  );
}
