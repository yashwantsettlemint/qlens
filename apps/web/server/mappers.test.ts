import { describe, expect, it } from "vitest";
import { effectivePayment, mapInvoice, vendorStats } from "./mappers";

const baseRow = {
  id: "inv-1",
  invoice_number: "INV-1",
  direction: "payable",
  invoice_date: "2020-01-01",
  due_date: "2020-01-10",
  amount: "100",
  tax_amount: "18",
  department: "ops",
  approval_status: "pending",
  payment_status: "unpaid",
  source: "manual",
};

describe("effectivePayment", () => {
  it("is PAID when payment_status is paid, regardless of due date", () => {
    expect(effectivePayment({ ...baseRow, payment_status: "paid", due_date: "2000-01-01" })).toBe("PAID");
  });

  it("is OVERDUE when unpaid and due date is in the past", () => {
    expect(effectivePayment({ ...baseRow, payment_status: "unpaid", due_date: "2000-01-01" })).toBe("OVERDUE");
  });

  it("is UNPAID when unpaid and due date is in the future", () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect(effectivePayment({ ...baseRow, payment_status: "unpaid", due_date: future })).toBe("UNPAID");
  });
});

describe("mapInvoice", () => {
  it("returns null for a null row", () => {
    expect(mapInvoice(null)).toBeNull();
  });

  it("maps snake_case amounts/status to the camelCase GraphQL shape", () => {
    const mapped = mapInvoice(baseRow);
    expect(mapped).toMatchObject({
      id: "inv-1",
      invoiceNumber: "INV-1",
      direction: "PAYABLE",
      amount: 100,
      taxAmount: 18,
      approvalStatus: "PENDING",
    });
  });
});

describe("vendorStats", () => {
  it("reports zero exposure and 100% on-time for a vendor with no invoices", () => {
    const stats = vendorStats({ id: "v1", name: "Acme", invoices: [] });
    expect(stats.totalInvoices).toBe(0);
    expect(stats.totalExposure).toBe(0);
    expect(stats.onTimePct).toBe(100);
    expect(stats.avgDelayDays).toBe(0);
  });

  it("excludes paid invoices from exposure and computes on-time / delay from payments", () => {
    const stats = vendorStats({
      id: "v1",
      name: "Acme",
      invoices: [
        // paid on time -> excluded from exposure, counts toward onTimePct
        { amount: "50", tax_amount: "0", payment_status: "paid", due_date: "2020-01-10", payments: [{ paid_at: "2020-01-10" }] },
        // paid 5 days late -> excluded from exposure, drags down onTimePct and avgDelayDays
        { amount: "30", tax_amount: "0", payment_status: "paid", due_date: "2020-01-10", payments: [{ paid_at: "2020-01-15" }] },
        // unpaid -> counts toward exposure
        { amount: "20", tax_amount: "5", payment_status: "unpaid", due_date: "2999-01-01", payments: [] },
      ],
    });
    expect(stats.totalInvoices).toBe(3);
    expect(stats.totalExposure).toBe(25); // only the unpaid row: 20 + 5
    expect(stats.onTimePct).toBe(50); // 1 of 2 paid invoices was on time
    expect(stats.avgDelayDays).toBe(2.5); // (0 + 5) / 2
  });

  it("treats a paid invoice with no recorded payment row as zero delay", () => {
    const stats = vendorStats({
      id: "v1",
      name: "Acme",
      invoices: [{ amount: "10", tax_amount: "0", payment_status: "paid", due_date: "2020-01-10", payments: [] }],
    });
    expect(stats.avgDelayDays).toBe(0);
    expect(stats.onTimePct).toBe(100);
  });
});
