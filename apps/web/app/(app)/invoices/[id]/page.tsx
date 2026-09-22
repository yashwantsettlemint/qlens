"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@apollo/client";
import { InvoiceDetailQuery } from "@/graphql/operations/queries";
import { SetApprovalMutation, DeleteInvoiceMutation } from "@/graphql/operations/mutations";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { QueryState } from "@/components/ui/QueryState";
import {
  ApprovalBadge,
  PaymentBadge,
  OverdueBadge,
  DuplicateBadge,
} from "@/components/ui/Badge";
import { DuplicateCallout } from "@/components/invoice/DuplicateCallout";
import { InvoiceSummaryPanel } from "@/components/invoice/InvoiceSummaryPanel";
import { ApprovalTimeline } from "@/components/invoice/ApprovalTimeline";
import { PaymentPanel } from "@/components/invoice/PaymentPanel";
import { inr, fmtDate } from "@/lib/format";
import { useRole } from "@/lib/role";

export default function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const { can } = useRole();
  const router = useRouter();
  const { data, loading, error } = useQuery(InvoiceDetailQuery, {
    variables: { id: params.id },
  });
  const [setApproval, approvalState] = useMutation(SetApprovalMutation, {
    refetchQueries: ["InvoiceDetail", "DashboardStats", "Invoices"],
    awaitRefetchQueries: true,
    onError: () => {}, // shown below via approvalState.error, not thrown
  });
  const [deleteInvoice, deleteState] = useMutation(DeleteInvoiceMutation, {
    refetchQueries: ["DashboardStats", "Invoices"],
    onError: () => {}, // shown below via deleteState.error, not thrown
  });

  const inv = data?.invoice;

  return (
    <QueryState loading={loading && !inv} error={error} minRows={6}>
      {!inv ? (
        <p className="text-sm text-ink-muted">Invoice not found.</p>
      ) : (
        <>
          <PageHeader
            title={<span className="tabular">{inv.invoiceNumber}</span>}
            meta={
              <span>
                <Link href={`/vendors/${inv.vendor?.id}`} className="text-accent hover:underline">
                  {inv.vendor?.name}
                </Link>{" "}
                · {inv.department}
              </span>
            }
            actions={
              <>
                {inv.approvalStatus === "PENDING" && can("approve") && (
                  <>
                    <Button
                      variant="primary"
                      data-testid="approve-invoice"
                      disabled={approvalState.loading}
                      onClick={() =>
                        setApproval({ variables: { id: inv.id, status: "APPROVED" } })
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      variant="danger"
                      data-testid="reject-invoice"
                      disabled={approvalState.loading}
                      onClick={() => {
                        const note = window.prompt("Reason for rejection?") ?? undefined;
                        setApproval({
                          variables: { id: inv.id, status: "REJECTED", note },
                        });
                      }}
                    >
                      Reject
                    </Button>
                  </>
                )}
                {can("deleteInvoice") && (
                  <Button
                    variant="danger"
                    data-testid="delete-invoice"
                    disabled={deleteState.loading}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Delete invoice ${inv.invoiceNumber}? This can't be undone.`,
                        )
                      )
                        return;
                      const res = await deleteInvoice({ variables: { id: inv.id } });
                      if (res.data?.deleteInvoice) router.push("/invoices");
                    }}
                  >
                    Delete
                  </Button>
                )}
              </>
            }
          />

          {deleteState.error && (
            <Callout tone="bad" className="mb-4">
              {deleteState.error.message}
            </Callout>
          )}

          {approvalState.error && (
            <Callout tone="bad" className="mb-4">
              {approvalState.error.message}
            </Callout>
          )}

          <div className="mb-4 flex flex-wrap gap-2">
            <ApprovalBadge status={inv.approvalStatus} />
            <PaymentBadge status={inv.paymentStatus} />
            {inv.daysOverdue > 0 && <OverdueBadge days={inv.daysOverdue} />}
            {inv.duplicateFlag && <DuplicateBadge />}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="space-y-4">
              <InvoiceSummaryPanel invoiceId={inv.id} description={inv.description} />
              <Panel title="Details">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                  <Detail label="Amount" value={inr(inv.amount)} mono />
                  <Detail label="Tax (GST)" value={inr(inv.taxAmount)} mono />
                  <Detail label="Total" value={inr(inv.amount + inv.taxAmount)} mono />
                  <Detail label="Invoice date" value={fmtDate(inv.invoiceDate)} mono />
                  <Detail label="Due date" value={fmtDate(inv.dueDate)} mono />
                  <Detail
                    label="Payment terms"
                    value={
                      inv.vendor?.paymentTermsDays ? `${inv.vendor.paymentTermsDays} days` : "—"
                    }
                  />
                  <Detail
                    label="Purchase order"
                    value={
                      inv.purchaseOrder
                        ? `${inv.purchaseOrder.poNumber} · ${inv.purchaseOrder.status}`
                        : "Not linked"
                    }
                  />
                  <Detail label="Source" value={inv.source} />
                  <Detail label="Vendor GSTIN" value={inv.vendor?.taxId ?? "—"} mono />
                </dl>
              </Panel>

              <ApprovalTimeline events={inv.approvalEvents} />
            </div>

            <div className="space-y-4">
              {inv.duplicateFlag && (
                <DuplicateCallout invoiceId={inv.id} flag={inv.duplicateFlag} />
              )}
              {/* Delay risk is a receivables concern (will the customer pay late?) —
                  for a payable, the due date already on this page is what matters. */}
              <PaymentPanel
                invoiceId={inv.id}
                total={inv.amount + inv.taxAmount}
                approvalStatus={inv.approvalStatus}
                paymentStatus={inv.paymentStatus}
                payments={inv.payments}
                canRecord={can("recordPayment")}
              />
            </div>
          </div>
        </>
      )}
    </QueryState>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={mono ? "tabular mt-0.5" : "mt-0.5"}>{value}</dd>
    </div>
  );
}
