import { describe, expect, it } from "vitest";
import { vendorHistoryStats, quarterlyTrend, nextBillEstimate, signedLateness, paidBills } from "./vendorHistory";
import type { InvoiceRow } from "./types";

function bill(overrides: Partial<InvoiceRow> & { dueDate: string; paidAt?: string | null }): InvoiceRow {
  const { paidAt, ...rest } = overrides;
  return {
    id: rest.invoiceNumber ?? "inv",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-01-01",
    amount: 1000,
    taxAmount: 0,
    department: "IT",
    source: "manual",
    daysOverdue: 0,
    direction: "PAYABLE",
    collectionStatus: null,
    vendor: null,
    customer: null,
    duplicateFlag: null,
    delayPrediction: null,
    paymentStatus: paidAt ? "PAID" : "UNPAID",
    payments: paidAt ? [{ paidAt, amountPaid: 1000 } as any] : [],
    ...rest,
  } as InvoiceRow;
}

describe("signedLateness / paidBills", () => {
  it("is positive for a late payment, negative for early, 0 on time", () => {
    const late = bill({ invoiceNumber: "A", dueDate: "2026-01-10", paidAt: "2026-01-15" });
    const early = bill({ invoiceNumber: "B", dueDate: "2026-01-10", paidAt: "2026-01-05" });
    const onTime = bill({ invoiceNumber: "C", dueDate: "2026-01-10", paidAt: "2026-01-10" });
    expect(signedLateness(paidBills([late])[0])).toBe(5);
    expect(signedLateness(paidBills([early])[0])).toBe(-5);
    expect(signedLateness(paidBills([onTime])[0])).toBe(0);
  });

  it("excludes unpaid invoices", () => {
    const unpaid = bill({ invoiceNumber: "D", dueDate: "2026-01-10" });
    expect(paidBills([unpaid])).toHaveLength(0);
  });
});

describe("vendorHistoryStats", () => {
  it("averages signed lateness and counts on-time-or-early as a %", () => {
    const invoices = [
      bill({ invoiceNumber: "A", dueDate: "2026-01-10", paidAt: "2026-01-15" }), // +5
      bill({ invoiceNumber: "B", dueDate: "2026-01-10", paidAt: "2026-01-05" }), // -5
      bill({ invoiceNumber: "C", dueDate: "2026-01-10", paidAt: "2026-01-10" }), // 0
    ];
    const s = vendorHistoryStats(invoices);
    expect(s.avgVsDueDays).toBe(0);
    expect(s.onTimeOrEarlyPct).toBe(67); // B and C, not A
  });

  it("tracks the single longest delay and its invoice number", () => {
    const invoices = [
      bill({ invoiceNumber: "A", dueDate: "2026-01-10", paidAt: "2026-01-12" }), // +2
      bill({ invoiceNumber: "B", dueDate: "2026-02-10", paidAt: "2026-03-09" }), // +27
    ];
    const s = vendorHistoryStats(invoices);
    expect(s.longestDelayDays).toBe(27);
    expect(s.longestDelayInvoice).toBe("B");
  });

  it("sums open (unpaid) amount including tax, ignoring paid invoices", () => {
    const invoices = [
      bill({ invoiceNumber: "A", dueDate: "2026-01-10", paidAt: "2026-01-10", amount: 1000, taxAmount: 180 }),
      bill({ invoiceNumber: "B", dueDate: "2026-03-10", amount: 500, taxAmount: 90 }),
    ];
    expect(vendorHistoryStats(invoices).openAmount).toBe(590);
  });

  it("defaults sensibly with no paid history", () => {
    const s = vendorHistoryStats([bill({ invoiceNumber: "A", dueDate: "2026-01-10" })]);
    expect(s.avgVsDueDays).toBe(0);
    expect(s.onTimeOrEarlyPct).toBe(100);
    expect(s.longestDelayInvoice).toBeNull();
  });
});

describe("quarterlyTrend", () => {
  it("buckets by the due date's calendar quarter, oldest first", () => {
    const invoices = [
      bill({ invoiceNumber: "A", dueDate: "2026-04-15", paidAt: "2026-04-20" }), // Q2, +5
      bill({ invoiceNumber: "B", dueDate: "2026-01-15", paidAt: "2026-01-15" }), // Q1, 0
      bill({ invoiceNumber: "C", dueDate: "2026-04-01", paidAt: "2026-04-01" }), // Q2, 0
    ];
    const trend = quarterlyTrend(invoices);
    expect(trend.map((t) => t.label)).toEqual(["Q1 2026", "Q2 2026"]);
    expect(trend[1].avgVsDueDays).toBe(2.5); // (5 + 0) / 2
    expect(trend[1].billCount).toBe(2);
  });
});

describe("nextBillEstimate", () => {
  it("returns null with fewer than 2 paid bills", () => {
    expect(nextBillEstimate([bill({ invoiceNumber: "A", dueDate: "2026-01-10", paidAt: "2026-01-10" })])).toBeNull();
  });

  it("centers the window on the mean and reports the late share", () => {
    const invoices = [
      bill({ invoiceNumber: "A", dueDate: "2026-01-10", paidAt: "2026-01-14" }), // +4
      bill({ invoiceNumber: "B", dueDate: "2026-02-10", paidAt: "2026-02-16" }), // +6
    ];
    const est = nextBillEstimate(invoices)!;
    expect(est.mostLikelyDays).toBe(5);
    expect(est.lateChancePct).toBe(100);
    expect(est.windowStart).toBeLessThanOrEqual(5);
    expect(est.windowEnd).toBeGreaterThanOrEqual(5);
  });
});
