/**
 * Seeded, deterministic mock dataset — realistic Indian AP data. Arrays are
 * mutable: resolver mutations (approve, review duplicate, record payment,
 * import) edit them in place, so the demo is stateful for the session and
 * resets on a full page reload.
 */

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type StoredPaymentStatus = "UNPAID" | "PAID";
export type InvoiceSource = "manual" | "csv" | "ocr";
export type ReviewedStatus = "unreviewed" | "confirmed_duplicate" | "false_positive";

export interface VendorRow {
  id: string;
  name: string;
  taxId: string;
  paymentTermsDays: number;
}
export interface PORow {
  id: string;
  poNumber: string;
  vendorId: string;
  amount: number;
  department: string;
  status: string;
}
export interface DuplicateFlagRow {
  matchedInvoiceId: string;
  confidenceScore: number;
  reviewedStatus: ReviewedStatus;
}
export interface DelayPredictionRow {
  delayProbability: number;
  predictedDelayDays: number;
  modelVersion: string;
}
export interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  vendorId: string;
  purchaseOrderId: string | null;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  taxAmount: number;
  department: string;
  approvalStatus: ApprovalStatus;
  paymentStatus: StoredPaymentStatus;
  source: InvoiceSource;
  duplicateFlag: DuplicateFlagRow | null;
  delayPrediction: DelayPredictionRow | null;
}
export interface PaymentRow {
  id: string;
  invoiceId: string;
  paidAt: string | null;
  amountPaid: number;
}
export interface ApprovalEventRow {
  id: string;
  invoiceId: string;
  actor: string;
  action: "submitted" | "approved" | "rejected";
  note: string | null;
  at: string;
}

// Anchor date for the whole dataset (keeps "overdue" stable in the demo).
export const TODAY = new Date("2026-09-07T00:00:00Z");

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260907);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

const DEPARTMENTS = ["Procurement", "IT", "Facilities", "Marketing", "Logistics", "HR"];
const APPROVERS = ["Priya Nair", "Rahul Menon", "Anjali Rao"];
const SUBMITTERS: Record<InvoiceSource, string> = {
  manual: "Kavya Iyer",
  csv: "CSV import",
  ocr: "OCR pipeline",
};

export const vendors: VendorRow[] = [
  ["Tata Consultancy Services", "27AAACT2727Q1ZW", 45],
  ["Reliance Retail Ltd", "27AAACR5055K1Z7", 30],
  ["Infosys BPM Ltd", "29AAACI4741P1ZL", 60],
  ["Godrej & Boyce Mfg Co", "27AAACG1234M1Z5", 45],
  ["Asian Paints Ltd", "27AAACA6666B1Z3", 30],
  ["Bharat Forge Ltd", "27AAACB4589R1ZP", 60],
  ["Havells India Ltd", "09AAACH1234A1ZQ", 30],
  ["Blue Dart Express Ltd", "27AAACB0028P1ZT", 15],
  ["Zensar Technologies Ltd", "27AAACZ0987F1ZK", 45],
  ["UrbanClap Technologies Pvt Ltd", "29AABCU9603R1ZM", 30],
].map(([name, taxId, terms], i) => ({
  id: `ven-${i + 1}`,
  name: name as string,
  taxId: taxId as string,
  paymentTermsDays: terms as number,
}));

// Purchase orders — ~2 per vendor.
export const purchaseOrders: PORow[] = [];
vendors.forEach((v, vi) => {
  for (let k = 0; k < 2; k++) {
    const n = purchaseOrders.length + 1;
    purchaseOrders.push({
      id: `po-${n}`,
      poNumber: `PO-2026-${String(1000 + n)}`,
      vendorId: v.id,
      amount: round2(int(5, 60) * 100000 + rnd() * 50000),
      department: DEPARTMENTS[(vi + k) % DEPARTMENTS.length],
      status: pick(["OPEN", "PARTIAL", "CLOSED"]),
    });
  }
});

// Invoices.
export const invoices: InvoiceRow[] = [];
const INVOICE_COUNT = 62;
for (let i = 0; i < INVOICE_COUNT; i++) {
  const vendor = vendors[int(0, vendors.length - 1)];
  const vendorPOs = purchaseOrders.filter((p) => p.vendorId === vendor.id);
  const po = rnd() < 0.7 ? pick(vendorPOs) : null;
  const dept = po ? po.department : pick(DEPARTMENTS);
  const invoiceDate = addDays(TODAY, -int(2, 150));
  const dueDate = addDays(invoiceDate, vendor.paymentTermsDays);
  const amount = round2(int(15, 4000) * 1000 + rnd() * 900);
  const taxAmount = round2(amount * 0.18);

  const ar = rnd();
  const approvalStatus: ApprovalStatus = ar < 0.44 ? "PENDING" : ar < 0.9 ? "APPROVED" : "REJECTED";
  let paymentStatus: StoredPaymentStatus = "UNPAID";
  if (approvalStatus === "APPROVED" && rnd() < 0.62) paymentStatus = "PAID";
  const source = pick(["manual", "csv", "ocr", "csv", "manual"]) as InvoiceSource;

  invoices.push({
    id: `inv-${i + 1}`,
    invoiceNumber: `${vendor.name.split(" ")[0].toUpperCase().slice(0, 4)}/26-27/${String(1041 + i)}`,
    vendorId: vendor.id,
    purchaseOrderId: po ? po.id : null,
    invoiceDate: iso(invoiceDate),
    dueDate: iso(dueDate),
    amount,
    taxAmount,
    department: dept,
    approvalStatus,
    paymentStatus,
    source,
    duplicateFlag: null,
    delayPrediction: null,
  });
}

// Duplicate flags on ~8 invoices — matched to another invoice from the same vendor.
const dupTargets = invoices.filter((_, i) => i % 8 === 3).slice(0, 8);
for (const inv of dupTargets) {
  const sibling = invoices.find((o) => o.vendorId === inv.vendorId && o.id !== inv.id);
  if (!sibling) continue;
  inv.duplicateFlag = {
    matchedInvoiceId: sibling.id,
    confidenceScore: round2(0.72 + rnd() * 0.26),
    reviewedStatus: pick([
      "unreviewed",
      "unreviewed",
      "unreviewed",
      "confirmed_duplicate",
      "false_positive",
    ]) as ReviewedStatus,
  };
}

// Delay predictions on ~22 invoices, weighted toward not-yet-paid ones.
let delayGiven = 0;
for (const inv of invoices) {
  if (delayGiven >= 22) break;
  const eligible = inv.paymentStatus !== "PAID";
  if (!eligible && rnd() < 0.8) continue;
  if (rnd() < 0.45) continue;
  const p = round2(0.08 + rnd() * 0.88);
  inv.delayPrediction = {
    delayProbability: p,
    predictedDelayDays: Math.max(1, Math.round(p * 24 + rnd() * 6)),
    modelVersion: "delay-risk-v2.3",
  };
  delayGiven++;
}

// Payments + approval timeline, derived from invoice state.
export const payments: PaymentRow[] = [];
export const approvalEvents: ApprovalEventRow[] = [];
let payNo = 0;
let evtNo = 0;
for (const inv of invoices) {
  approvalEvents.push({
    id: `evt-${++evtNo}`,
    invoiceId: inv.id,
    actor: SUBMITTERS[inv.source],
    action: "submitted",
    note: null,
    at: `${inv.invoiceDate}T09:${String(int(10, 59))}:00Z`,
  });
  if (inv.approvalStatus === "APPROVED") {
    approvalEvents.push({
      id: `evt-${++evtNo}`,
      invoiceId: inv.id,
      actor: pick(APPROVERS),
      action: "approved",
      note: null,
      at: `${iso(addDays(new Date(inv.invoiceDate), int(1, 6)))}T14:${String(int(10, 59))}:00Z`,
    });
  }
  if (inv.approvalStatus === "REJECTED") {
    approvalEvents.push({
      id: `evt-${++evtNo}`,
      invoiceId: inv.id,
      actor: pick(APPROVERS),
      action: "rejected",
      note: pick([
        "PO amount mismatch — exceeds approved value",
        "Missing GST breakup on the invoice copy",
        "Duplicate of an earlier submission",
        "Department cost centre not authorised",
      ]),
      at: `${iso(addDays(new Date(inv.invoiceDate), int(1, 5)))}T11:${String(int(10, 59))}:00Z`,
    });
  }
  if (inv.paymentStatus === "PAID") {
    payments.push({
      id: `pay-${++payNo}`,
      invoiceId: inv.id,
      // spread around the due date so vendors show a realistic mix of on-time / late
      paidAt: iso(addDays(new Date(inv.dueDate), int(-16, 12))),
      amountPaid: round2(inv.amount + inv.taxAmount),
    });
  }
}

export const db = { vendors, purchaseOrders, invoices, payments, approvalEvents };
