"use client";

import { useState } from "react";
import { useMutation } from "@apollo/client";
import { RecordPaymentMutation } from "@/graphql/operations/mutations";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field, DateInput, TextInput } from "@/components/ui/Field";
import { inr, fmtDate } from "@/lib/format";
import type { InvoiceDetail } from "@/lib/types";

const TODAY = "2026-09-07";

export function PaymentPanel({
  invoiceId,
  total,
  approvalStatus,
  paymentStatus,
  payments,
  canRecord,
  title = "Payment",
  actionLabel = "Mark as paid",
  showGateway = true,
}: {
  invoiceId: string;
  total: number;
  approvalStatus: string;
  paymentStatus: string;
  payments: InvoiceDetail["payments"];
  /** false for roles that can't mark invoices paid (approver) — history only. */
  canRecord: boolean;
  /** AR passes "Receipt" / "Mark as received". */
  title?: string;
  actionLabel?: string;
  /** Payables only — AR has nothing to pay out via a gateway. */
  showGateway?: boolean;
}) {
  const [paidAt, setPaidAt] = useState(TODAY);
  const [amount, setAmount] = useState(String(total));
  const [gatewayBusy, setGatewayBusy] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [record, { loading, error }] = useMutation(RecordPaymentMutation, {
    refetchQueries: ["InvoiceDetail", "DashboardStats", "Invoices"],
    awaitRefetchQueries: true,
    onError: () => {}, // shown via `error` below, not thrown
  });

  async function payViaGateway() {
    setGatewayBusy(true);
    setGatewayError(null);
    try {
      const res = await fetch("/api/payments/create-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGatewayError(data.error ?? `Payment gateway error (${res.status})`);
        return;
      }
      window.open(data.url as string, "_blank", "noopener,noreferrer");
    } catch {
      setGatewayError("Couldn't reach the payment gateway.");
    } finally {
      setGatewayBusy(false);
    }
  }

  const settled = paymentStatus === "PAID";
  const approved = approvalStatus === "APPROVED";

  return (
    <Panel title={title}>
      {payments.length > 0 && (
        <ul className="mb-3 space-y-1.5 text-sm">
          {payments.map((p) => (
            <li key={p.id} className="flex justify-between">
              <span className="text-ink-muted">
                {p.paidAt ? fmtDate(p.paidAt) : "Date not set"}
              </span>
              <span className="tabular">{inr(p.amountPaid)}</span>
            </li>
          ))}
        </ul>
      )}

      {settled ? (
        <p className="text-sm text-ok-fg">Settled.</p>
      ) : !canRecord ? (
        <p className="text-sm text-ink-muted">
          {payments.length ? "Partially paid — awaiting settlement." : "Not yet paid."}
        </p>
      ) : !approved ? (
        <p className="text-sm text-ink-muted">
          {approvalStatus === "REJECTED"
            ? "This invoice was rejected and can't be paid."
            : "Blocked until approval completes."}
        </p>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            record({
              variables: { invoiceId, paidAt, amountPaid: Number(amount) },
            });
          }}
        >
          <Field label="Payment date">
            <DateInput value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </Field>
          <Field label="Amount paid">
            <TextInput
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-40"
            />
          </Field>
          <Button variant="primary" type="submit" disabled={loading || !Number(amount)}>
            {actionLabel}
          </Button>
          {showGateway && (
            <Button type="button" onClick={payViaGateway} disabled={gatewayBusy}>
              {gatewayBusy ? "Opening…" : "Pay via Razorpay"}
            </Button>
          )}
          {error && (
            <Callout tone="bad" className="w-full">
              {error.message}
            </Callout>
          )}
          {gatewayError && (
            <Callout tone="bad" className="w-full">
              {gatewayError}
            </Callout>
          )}
        </form>
      )}
    </Panel>
  );
}
