"use client";

import { useState } from "react";
import { useMutation } from "@apollo/client";
import { RecordPaymentMutation } from "@/graphql/operations/mutations";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field, DateInput, TextInput } from "@/components/ui/Field";
import { inr, fmtDate } from "@/lib/format";
import type { InvoiceDetail } from "@/lib/types";

const TODAY = "2026-09-07";

export function PaymentPanel({
  invoiceId,
  total,
  paymentStatus,
  payments,
}: {
  invoiceId: string;
  total: number;
  paymentStatus: string;
  payments: InvoiceDetail["payments"];
}) {
  const [paidAt, setPaidAt] = useState(TODAY);
  const [amount, setAmount] = useState(String(total));
  const [record, { loading }] = useMutation(RecordPaymentMutation, {
    refetchQueries: ["InvoiceDetail", "DashboardStats", "Invoices"],
    awaitRefetchQueries: true,
  });

  const settled = paymentStatus === "PAID";

  return (
    <Panel title="Payment">
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
            Mark as paid
          </Button>
        </form>
      )}
    </Panel>
  );
}
