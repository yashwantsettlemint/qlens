/** Vendor payment-history math — how late/early we've actually paid a vendor's
 * bills, and a plain statistical estimate (not a model) of the next one.
 * Mirrors lib/risk.ts's style: pure functions, no React/GraphQL imports. */
import { daysBetween } from "./format";
import type { InvoiceRow } from "./types";

export type PaidBill = InvoiceRow & { paidAt: string };

/** Only paid payables with a recorded payment date. */
export function paidBills(invoices: InvoiceRow[]): PaidBill[] {
  return invoices
    .filter((i) => i.paymentStatus === "PAID" && i.payments[0]?.paidAt)
    .map((i) => ({ ...i, paidAt: i.payments[0].paidAt as string }));
}

/** Days paid after (+) or before (-) the due date — unlike vendorStats()'s
 * avgDelayDays (server/mappers.ts), this is signed: an early payment shows
 * negative, not clamped to 0. */
export function signedLateness(bill: PaidBill): number {
  return daysBetween(bill.paidAt, bill.dueDate);
}

export type VendorHistoryStats = {
  avgVsDueDays: number;
  onTimeOrEarlyPct: number;
  longestDelayDays: number;
  longestDelayInvoice: string | null;
  openAmount: number;
};

export function vendorHistoryStats(invoices: InvoiceRow[]): VendorHistoryStats {
  const bills = paidBills(invoices);
  const lateness = bills.map(signedLateness);
  const openAmount = invoices
    .filter((i) => i.paymentStatus !== "PAID")
    .reduce((sum, i) => sum + i.amount + i.taxAmount, 0);

  if (lateness.length === 0) {
    return { avgVsDueDays: 0, onTimeOrEarlyPct: 100, longestDelayDays: 0, longestDelayInvoice: null, openAmount };
  }
  const avgVsDueDays = Math.round((lateness.reduce((a, b) => a + b, 0) / lateness.length) * 10) / 10;
  const onTime = lateness.filter((d) => d <= 0).length;
  let longestDelayDays = -Infinity;
  let longestDelayInvoice: string | null = null;
  bills.forEach((bill, i) => {
    if (lateness[i] > longestDelayDays) {
      longestDelayDays = lateness[i];
      longestDelayInvoice = bill.invoiceNumber;
    }
  });
  return {
    avgVsDueDays,
    onTimeOrEarlyPct: Math.round((onTime / lateness.length) * 100),
    longestDelayDays: Math.max(0, longestDelayDays),
    longestDelayInvoice,
    openAmount,
  };
}

export type QuarterTrend = { label: string; avgVsDueDays: number; billCount: number };

/** Mean signed lateness per calendar quarter of each bill's due date,
 * oldest first. */
export function quarterlyTrend(invoices: InvoiceRow[]): QuarterTrend[] {
  const bills = paidBills(invoices);
  const buckets = new Map<string, { sum: number; count: number; label: string }>();
  for (const bill of bills) {
    const d = new Date(bill.dueDate);
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    const key = `${d.getUTCFullYear()}-Q${q}`;
    const label = `Q${q} ${d.getUTCFullYear()}`;
    const entry = buckets.get(key) ?? { sum: 0, count: 0, label };
    entry.sum += signedLateness(bill);
    entry.count += 1;
    buckets.set(key, entry);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, { sum, count, label }]) => ({
      label,
      avgVsDueDays: Math.round((sum / count) * 10) / 10,
      billCount: count,
    }));
}

export type NextBillEstimate = {
  windowStart: number;
  windowEnd: number;
  mostLikelyDays: number;
  lateChancePct: number;
};

/** A plain statistical read of this vendor's own payment history — not a
 * model prediction. Spread is the sample's own variability (mean absolute
 * deviation from the mean), so a vendor paid consistently around +5d gets a
 * tight window, and an erratic one gets a wide one. Null when there's not
 * enough history to say anything useful. */
export function nextBillEstimate(invoices: InvoiceRow[]): NextBillEstimate | null {
  const bills = paidBills(invoices);
  if (bills.length < 2) return null;
  const lateness = bills.map(signedLateness);
  const mean = lateness.reduce((a, b) => a + b, 0) / lateness.length;
  const spread = lateness.reduce((a, b) => a + Math.abs(b - mean), 0) / lateness.length;
  const late = lateness.filter((d) => d > 0).length;
  return {
    windowStart: Math.max(0, Math.round(mean - spread)),
    windowEnd: Math.max(0, Math.round(mean + spread)),
    mostLikelyDays: Math.round(mean),
    lateChancePct: Math.round((late / lateness.length) * 100),
  };
}
