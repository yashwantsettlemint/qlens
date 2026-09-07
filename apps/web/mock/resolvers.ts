import {
  db,
  TODAY,
  type InvoiceRow,
  type VendorRow,
  type ApprovalStatus,
  type ReviewedStatus,
} from "./data";
import { validateInvoiceInput } from "../lib/validateInvoice";

/** Payment status is derived: an unpaid invoice past its due date reads OVERDUE. */
export function effectivePaymentStatus(inv: InvoiceRow): "PAID" | "UNPAID" | "OVERDUE" {
  if (inv.paymentStatus === "PAID") return "PAID";
  return new Date(inv.dueDate) < TODAY ? "OVERDUE" : "UNPAID";
}
const dayDiff = (a: string | Date, b: string | Date) =>
  Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
const grossOutstanding = (inv: InvoiceRow) =>
  effectivePaymentStatus(inv) === "PAID" ? 0 : inv.amount + inv.taxAmount;
const daysOverdue = (inv: InvoiceRow) =>
  effectivePaymentStatus(inv) === "OVERDUE" ? dayDiff(TODAY, inv.dueDate) : 0;
const vendorById = (id: string) => db.vendors.find((v) => v.id === id)!;

function vendorStats(vendor: VendorRow) {
  const list = db.invoices.filter((i) => i.vendorId === vendor.id);
  const paid = list.filter((i) => i.paymentStatus === "PAID");
  const lateness = paid.map((i) => {
    const pay = db.payments.find((p) => p.invoiceId === i.id);
    return pay?.paidAt ? Math.max(0, dayDiff(pay.paidAt, i.dueDate)) : 0;
  });
  const avgDelayDays = lateness.length
    ? Math.round((lateness.reduce((a, b) => a + b, 0) / lateness.length) * 10) / 10
    : 0;
  const onTime = lateness.filter((d) => d === 0).length;
  return {
    vendor,
    totalInvoices: list.length,
    totalExposure: Math.round(list.reduce((s, i) => s + grossOutstanding(i), 0) * 100) / 100,
    avgDelayDays,
    onTimePct: paid.length ? Math.round((onTime / paid.length) * 100) : 100,
  };
}

interface InvoiceFilter {
  vendorId?: string | null;
  department?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  approvalStatus?: ApprovalStatus | null;
  paymentStatus?: "PAID" | "UNPAID" | "OVERDUE" | null;
  source?: string | null;
  q?: string | null;
}

function applyFilter(rows: InvoiceRow[], f: InvoiceFilter | null | undefined) {
  if (!f) return rows;
  return rows.filter((i) => {
    if (f.vendorId && i.vendorId !== f.vendorId) return false;
    if (f.department && i.department !== f.department) return false;
    if (f.source && i.source !== f.source) return false;
    if (f.approvalStatus && i.approvalStatus !== f.approvalStatus) return false;
    if (f.paymentStatus && effectivePaymentStatus(i) !== f.paymentStatus) return false;
    if (f.dateFrom && i.invoiceDate < f.dateFrom) return false;
    if (f.dateTo && i.invoiceDate > f.dateTo) return false;
    if (f.q) {
      const hay = `${i.invoiceNumber} ${vendorById(i.vendorId).name}`.toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  });
}

function sortKey(i: InvoiceRow, field: string): string | number {
  switch (field) {
    case "amount":
      return i.amount + i.taxAmount;
    case "vendor":
      return vendorById(i.vendorId).name;
    case "invoiceNumber":
      return i.invoiceNumber;
    case "invoiceDate":
      return i.invoiceDate;
    case "department":
      return i.department;
    case "approvalStatus":
      return i.approvalStatus;
    case "paymentStatus":
      return effectivePaymentStatus(i);
    case "daysOverdue":
      return daysOverdue(i);
    case "delayProbability":
      return i.delayPrediction?.delayProbability ?? -1;
    case "dueDate":
    default:
      return i.dueDate;
  }
}

function applySort(rows: InvoiceRow[], sort?: { field: string; dir: "ASC" | "DESC" } | null) {
  const { field, dir } = sort ?? { field: "dueDate", dir: "ASC" };
  const sign = dir === "DESC" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const ka = sortKey(a, field);
    const kb = sortKey(b, field);
    if (ka < kb) return -1 * sign;
    if (ka > kb) return 1 * sign;
    return 0;
  });
}

function askAnswer(prompt: string) {
  const p = prompt.toLowerCase();
  const inr = (n: number) =>
    "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
  const withGross = (i: InvoiceRow) => i.amount + i.taxAmount;

  const invRef = prompt.match(/[A-Z]{3,4}\/26-27\/\d+/);
  if (invRef) {
    const inv = db.invoices.find((i) => i.invoiceNumber === invRef[0]);
    if (inv?.duplicateFlag) {
      const match = db.invoices.find((x) => x.id === inv.duplicateFlag!.matchedInvoiceId);
      return {
        text: `${inv.invoiceNumber} was flagged as a possible duplicate of ${match?.invoiceNumber} from the same vendor (${vendorById(inv.vendorId).name}). The matcher scored the pair at ${Math.round(inv.duplicateFlag.confidenceScore * 100)}% on invoice number, amount and date proximity. Current review state: ${inv.duplicateFlag.reviewedStatus.replace("_", " ")}.`,
        invoices: [inv, match].filter(Boolean) as InvoiceRow[],
      };
    }
    return {
      text: inv
        ? `${inv.invoiceNumber} is not flagged. It is ${inv.approvalStatus.toLowerCase()} for approval and ${effectivePaymentStatus(inv).toLowerCase()} on payment.`
        : `No invoice matching "${invRef[0]}" is in the system.`,
      invoices: inv ? [inv] : [],
    };
  }

  if (p.includes("duplicate")) {
    const flagged = db.invoices.filter((i) => i.duplicateFlag);
    return {
      text: `${flagged.length} invoices currently carry a duplicate flag. ${flagged.filter((i) => i.duplicateFlag!.reviewedStatus === "unreviewed").length} are still unreviewed. Highest-confidence matches are listed below — open each to confirm or clear the flag.`,
      invoices: flagged.sort(
        (a, b) => b.duplicateFlag!.confidenceScore - a.duplicateFlag!.confidenceScore,
      ),
    };
  }

  if (p.includes("overdue")) {
    const od = db.invoices
      .filter((i) => effectivePaymentStatus(i) === "OVERDUE")
      .sort((a, b) => daysOverdue(b) - daysOverdue(a));
    const total = od.reduce((s, i) => s + withGross(i), 0);
    return {
      text: `${od.length} invoices are overdue, totalling ${inr(total)}. The oldest is ${daysOverdue(od[0]) || 0} days past due. Vendors with the largest overdue balances are at the top.`,
      invoices: od,
    };
  }

  if (p.includes("high-risk") || p.includes("high risk") || p.includes("risk") || p.includes("late")) {
    const risky = db.invoices
      .filter((i) => (i.delayPrediction?.delayProbability ?? 0) >= 0.67)
      .sort(
        (a, b) =>
          (b.delayPrediction?.delayProbability ?? 0) - (a.delayPrediction?.delayProbability ?? 0),
      );
    const exposure = risky.reduce((s, i) => s + withGross(i), 0);
    return {
      text: `${risky.length} unpaid invoices have a delay probability of 67% or higher, ${inr(exposure)} of exposure at risk of slipping past terms. The model attributes most of this to vendor payment history and month-end approval load.`,
      invoices: risky,
    };
  }

  const top = [...db.invoices]
    .filter((i) => effectivePaymentStatus(i) !== "PAID")
    .sort((a, b) => withGross(b) - withGross(a))
    .slice(0, 8);
  return {
    text: `I can answer questions about approvals, overdue balances, duplicate flags and delay risk. For example: "summarise all high-risk invoices this month" or "explain why ${db.invoices.find((i) => i.duplicateFlag)?.invoiceNumber} is flagged as duplicate". The largest open balances right now are below.`,
    invoices: top,
  };
}

export const resolvers = {
  Query: {
    dashboardStats: (_: unknown, { vendorId }: { vendorId?: string | null }) => {
      const rows = vendorId
        ? db.invoices.filter((i) => i.vendorId === vendorId)
        : db.invoices;
      const pending = rows.filter((i) => i.approvalStatus === "PENDING");
      const overdue = rows.filter((i) => effectivePaymentStatus(i) === "OVERDUE");
      return {
        pendingCount: pending.length,
        pendingAmount: round(pending.reduce((s, i) => s + i.amount + i.taxAmount, 0)),
        overdueCount: overdue.length,
        overdueAmount: round(overdue.reduce((s, i) => s + i.amount + i.taxAmount, 0)),
        vendorExposureTotal: round(rows.reduce((s, i) => s + grossOutstanding(i), 0)),
      };
    },
    invoices: (
      _: unknown,
      {
        filter,
        sort,
        page = 1,
        pageSize = 25,
      }: {
        filter?: InvoiceFilter | null;
        sort?: { field: string; dir: "ASC" | "DESC" } | null;
        page?: number;
        pageSize?: number;
      },
    ) => {
      const filtered = applySort(applyFilter(db.invoices, filter), sort);
      const start = (page - 1) * pageSize;
      return {
        rows: filtered.slice(start, start + pageSize),
        total: filtered.length,
        page,
        pageSize,
      };
    },
    invoice: (_: unknown, { id }: { id: string }) =>
      db.invoices.find((i) => i.id === id) ?? null,
    vendors: () => db.vendors.map(vendorStats),
    vendor: (_: unknown, { id }: { id: string }) => {
      const v = db.vendors.find((x) => x.id === id);
      return v ? vendorStats(v) : null;
    },
    vendorExposure: (_: unknown, { vendorId }: { vendorId?: string | null }) => {
      const list = (vendorId ? db.vendors.filter((v) => v.id === vendorId) : db.vendors).map(
        (v) => ({
          vendorId: v.id,
          vendorName: v.name,
          outstanding: round(
            db.invoices
              .filter((i) => i.vendorId === v.id)
              .reduce((s, i) => s + grossOutstanding(i), 0),
          ),
        }),
      );
      return list.sort((a, b) => b.outstanding - a.outstanding);
    },
    ask: (_: unknown, { prompt }: { prompt: string }) => askAnswer(prompt),
  },

  Mutation: {
    approveInvoices: (_: unknown, { ids }: { ids: string[] }) => {
      const changed: InvoiceRow[] = [];
      for (const id of ids) {
        const inv = db.invoices.find((i) => i.id === id);
        if (!inv || inv.approvalStatus !== "PENDING") continue;
        inv.approvalStatus = "APPROVED";
        db.approvalEvents.push({
          id: `evt-${db.approvalEvents.length + 1}`,
          invoiceId: inv.id,
          actor: "You",
          action: "approved",
          note: "Bulk approval",
          at: new Date().toISOString(),
        });
        changed.push(inv);
      }
      return changed;
    },
    setApproval: (
      _: unknown,
      { id, status, note }: { id: string; status: ApprovalStatus; note?: string | null },
    ) => {
      const inv = db.invoices.find((i) => i.id === id);
      if (!inv) throw new Error("Invoice not found");
      inv.approvalStatus = status;
      db.approvalEvents.push({
        id: `evt-${db.approvalEvents.length + 1}`,
        invoiceId: inv.id,
        actor: "You",
        action: status === "APPROVED" ? "approved" : "rejected",
        note: note ?? null,
        at: new Date().toISOString(),
      });
      return inv;
    },
    reviewDuplicate: (
      _: unknown,
      { invoiceId, status }: { invoiceId: string; status: string },
    ) => {
      const inv = db.invoices.find((i) => i.id === invoiceId);
      if (!inv?.duplicateFlag) throw new Error("No duplicate flag on this invoice");
      inv.duplicateFlag.reviewedStatus = status as ReviewedStatus;
      return inv;
    },
    recordPayment: (
      _: unknown,
      {
        invoiceId,
        paidAt,
        amountPaid,
      }: { invoiceId: string; paidAt: string; amountPaid: number },
    ) => {
      const inv = db.invoices.find((i) => i.id === invoiceId);
      if (!inv) throw new Error("Invoice not found");
      const payment = {
        id: `pay-${db.payments.length + 1}`,
        invoiceId,
        paidAt,
        amountPaid,
      };
      db.payments.push(payment);
      inv.paymentStatus = "PAID";
      return payment;
    },
    createInvoice: (_: unknown, { input }: { input: any }) => {
      const row = buildInvoice(input);
      db.invoices.push(row);
      db.approvalEvents.push({
        id: `evt-${db.approvalEvents.length + 1}`,
        invoiceId: row.id,
        actor: "Kavya Iyer",
        action: "submitted",
        note: null,
        at: new Date().toISOString(),
      });
      return row;
    },
    importInvoices: (_: unknown, { rows }: { rows: any[] }) => {
      const knownIds = new Set(db.vendors.map((v) => v.id));
      const errors: { row: number; message: string }[] = [];
      let created = 0;
      rows.forEach((input, idx) => {
        const problem = validateInvoiceInput(input, knownIds);
        if (problem) {
          errors.push({ row: idx + 1, message: problem });
          return;
        }
        db.invoices.push(buildInvoice(input));
        created++;
      });
      return { created, failed: errors.length, errors };
    },
  },

  Invoice: {
    vendor: (i: InvoiceRow) => vendorById(i.vendorId),
    purchaseOrder: (i: InvoiceRow) =>
      i.purchaseOrderId ? db.purchaseOrders.find((p) => p.id === i.purchaseOrderId) ?? null : null,
    paymentStatus: (i: InvoiceRow) => effectivePaymentStatus(i),
    daysOverdue: (i: InvoiceRow) => daysOverdue(i),
    approvalEvents: (i: InvoiceRow) =>
      db.approvalEvents
        .filter((e) => e.invoiceId === i.id)
        .sort((a, b) => a.at.localeCompare(b.at)),
    payments: (i: InvoiceRow) => db.payments.filter((p) => p.invoiceId === i.id),
  },
  DuplicateFlag: {
    matchedInvoice: (f: { matchedInvoiceId: string }) =>
      db.invoices.find((i) => i.id === f.matchedInvoiceId) ?? null,
  },
  PurchaseOrder: {
    vendor: (p: { vendorId: string }) => vendorById(p.vendorId),
  },
  Vendor: {
    invoices: (v: { id: string }) => db.invoices.filter((i) => i.vendorId === v.id),
  },
  Payment: {
    invoice: (p: { invoiceId: string }) => db.invoices.find((i) => i.id === p.invoiceId),
  },
};

function round(n: number) {
  return Math.round(n * 100) / 100;
}
// buildInvoice below is also used by createInvoice / importInvoices.

function buildInvoice(input: any): InvoiceRow {
  const n = db.invoices.length + 1;
  return {
    id: `inv-${n}`,
    invoiceNumber: String(input.invoiceNumber),
    vendorId: String(input.vendorId),
    purchaseOrderId: input.purchaseOrderId ? String(input.purchaseOrderId) : null,
    invoiceDate: String(input.invoiceDate),
    dueDate: String(input.dueDate),
    amount: Number(input.amount),
    taxAmount: Number(input.taxAmount),
    department: String(input.department),
    approvalStatus: "PENDING",
    paymentStatus: "UNPAID",
    source: (["manual", "csv", "ocr"].includes(input.source) ? input.source : "manual") as InvoiceRow["source"],
    duplicateFlag: null,
    delayPrediction: null,
  };
}
