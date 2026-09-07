import { describe, expect, it } from "vitest";
import { validateInvoiceInput, type InvoiceInputShape } from "./validateInvoice";

const VENDORS = new Set(["v1", "v2"]);
const ok: InvoiceInputShape = {
  invoiceNumber: "ACME/1",
  vendorId: "v1",
  invoiceDate: "2026-01-10",
  dueDate: "2026-02-09",
  amount: 1000,
  taxAmount: 180,
  department: "IT",
  source: "manual",
};

describe("validateInvoiceInput", () => {
  it("passes a well-formed row", () => {
    expect(validateInvoiceInput(ok, VENDORS)).toBeNull();
  });

  it("catches each field problem", () => {
    expect(validateInvoiceInput({ ...ok, invoiceNumber: "  " }, VENDORS)).toMatch(/Invoice number/);
    expect(validateInvoiceInput({ ...ok, vendorId: "nope" }, VENDORS)).toMatch(/Vendor/);
    expect(validateInvoiceInput({ ...ok, department: "Legal" }, VENDORS)).toMatch(/Department/);
    expect(validateInvoiceInput({ ...ok, amount: 0 }, VENDORS)).toMatch(/positive/);
    expect(validateInvoiceInput({ ...ok, taxAmount: -1 }, VENDORS)).toMatch(/zero or more/);
    expect(validateInvoiceInput({ ...ok, invoiceDate: "13/2026" }, VENDORS)).toMatch(/Invoice date/);
    expect(validateInvoiceInput({ ...ok, dueDate: "2026-01-01" }, VENDORS)).toMatch(/before the invoice date/);
    expect(validateInvoiceInput({ ...ok, source: "email" }, VENDORS)).toMatch(/Source/);
  });

  it("accepts due date equal to invoice date", () => {
    expect(validateInvoiceInput({ ...ok, dueDate: ok.invoiceDate }, VENDORS)).toBeNull();
  });
});
