import { describe, expect, it } from "vitest";
import { resolvers } from "./resolvers";
import { db } from "./data";

// The admin-only block on the dashboard. Seed data is deterministic but dated
// relative to "today", so assert invariants, not exact numbers.
describe("dashboardStats admin block", () => {
  const s = resolvers.Query.dashboardStats(null, {}) as Record<string, number>;

  it("rejectedCount matches the dataset; approvedUnpaid is a subset of approved", () => {
    const approved = db.invoices.filter((i) => i.approvalStatus === "APPROVED").length;
    const rejected = db.invoices.filter((i) => i.approvalStatus === "REJECTED").length;
    expect(s.rejectedCount).toBe(rejected);
    expect(s.approvedUnpaidCount).toBeGreaterThanOrEqual(0);
    expect(s.approvedUnpaidCount).toBeLessThanOrEqual(approved);
    expect(s.approvedUnpaidAmount).toBeGreaterThanOrEqual(0);
  });

  it("paid-in-last-30-days is a subset of all paid invoices", () => {
    const paid = db.invoices.filter((i) => i.paymentStatus === "PAID").length;
    expect(s.paidLast30Count).toBeLessThanOrEqual(paid);
    expect(s.paidLast30Amount).toBeGreaterThanOrEqual(0);
  });

  it("avgDaysToPay is a finite, non-negative number", () => {
    expect(Number.isFinite(s.avgDaysToPay)).toBe(true);
    expect(s.avgDaysToPay).toBeGreaterThanOrEqual(0);
  });

  it("still returns the base stats", () => {
    expect(s.pendingCount).toBeGreaterThanOrEqual(0);
    expect(s.vendorExposureTotal).toBeGreaterThan(0);
  });
});
