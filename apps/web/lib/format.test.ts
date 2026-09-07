import { describe, expect, it } from "vitest";
import { daysOverdue, pct, titleCase } from "./format";

describe("daysOverdue", () => {
  const due = "2026-01-10";
  it("is positive when past due, <= 0 before", () => {
    expect(daysOverdue(due, new Date("2026-01-15"))).toBe(5);
    expect(daysOverdue(due, new Date("2026-01-10"))).toBe(0);
    expect(daysOverdue(due, new Date("2026-01-05"))).toBe(-5);
  });
});

describe("pct", () => {
  it("renders a fraction as a percent string", () => {
    expect(pct(0.5)).toBe("50%");
    expect(pct(0.1234, 1)).toBe("12.3%");
  });
});

describe("titleCase", () => {
  it("splits underscores and capitalises words", () => {
    expect(titleCase("finance_user")).toBe("Finance User");
    expect(titleCase("overdue")).toBe("Overdue");
  });
});
