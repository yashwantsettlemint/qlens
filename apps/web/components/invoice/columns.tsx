import Link from "next/link";
import type { Column } from "@/components/ui/DataTable";
import type { InvoiceRow } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Money } from "@/components/ui/Money";
import {
  ApprovalBadge,
  PaymentBadge,
  OverdueBadge,
  DuplicateBadge,
} from "@/components/ui/Badge";
import { RiskDot } from "@/components/ui/RiskDot";

/**
 * Reusable invoice-table columns. Pages pick the set they need by key; the
 * order in `keys` is the render order.
 */
export const INVOICE_COLUMNS: Record<string, Column<InvoiceRow>> = {
  invoiceNumber: {
    key: "invoiceNumber",
    header: "Invoice #",
    sortable: true,
    sortValue: (r) => r.invoiceNumber,
    cell: (r) => <span className="tabular">{r.invoiceNumber}</span>,
  },
  vendor: {
    key: "vendor",
    header: "Vendor",
    sortable: true,
    sortValue: (r) => r.vendor.name,
    cell: (r) => (
      <Link
        href={`/vendors/${r.vendor.id}`}
        className="hover:text-accent hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {r.vendor.name}
      </Link>
    ),
  },
  department: {
    key: "department",
    header: "Dept",
    sortable: true,
    sortValue: (r) => r.department,
    cell: (r) => r.department,
  },
  invoiceDate: {
    key: "invoiceDate",
    header: "Invoice date",
    sortable: true,
    sortValue: (r) => r.invoiceDate,
    cell: (r) => <span className="tabular">{fmtDate(r.invoiceDate)}</span>,
  },
  dueDate: {
    key: "dueDate",
    header: "Due",
    sortable: true,
    sortValue: (r) => r.dueDate,
    cell: (r) => <span className="tabular">{fmtDate(r.dueDate)}</span>,
  },
  amount: {
    key: "amount",
    header: "Amount (incl. tax)",
    align: "right",
    sortable: true,
    sortValue: (r) => r.amount + r.taxAmount,
    cell: (r) => <Money value={r.amount + r.taxAmount} />,
  },
  daysOverdue: {
    key: "daysOverdue",
    header: "Overdue",
    align: "right",
    sortable: true,
    sortValue: (r) => r.daysOverdue,
    cell: (r) => <OverdueBadge days={r.daysOverdue} />,
  },
  duplicate: {
    key: "duplicate",
    header: "Dup",
    sortable: true,
    sortValue: (r) => (r.duplicateFlag ? 1 : 0),
    cell: (r) => (r.duplicateFlag ? <DuplicateBadge /> : <span className="text-ink-muted">—</span>),
  },
  risk: {
    key: "risk",
    header: "Delay risk",
    sortable: true,
    sortValue: (r) => r.delayPrediction?.delayProbability ?? -1,
    cell: (r) => <RiskDot probability={r.delayPrediction?.delayProbability} withLabel />,
  },
  approval: {
    key: "approvalStatus",
    header: "Approval",
    sortable: true,
    sortValue: (r) => r.approvalStatus,
    cell: (r) => <ApprovalBadge status={r.approvalStatus} />,
  },
  payment: {
    key: "paymentStatus",
    header: "Payment",
    sortable: true,
    sortValue: (r) => r.paymentStatus,
    cell: (r) => <PaymentBadge status={r.paymentStatus} />,
  },
  source: {
    key: "source",
    header: "Source",
    sortable: true,
    sortValue: (r) => r.source,
    cell: (r) => <span className="text-ink-muted">{r.source}</span>,
  },
};

export function pickInvoiceColumns(keys: string[]): Column<InvoiceRow>[] {
  return keys.map((k) => {
    const col = INVOICE_COLUMNS[k];
    if (!col) throw new Error(`Unknown invoice column: ${k}`);
    return col;
  });
}
