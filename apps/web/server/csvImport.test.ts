import { describe, expect, it, vi } from "vitest";

vi.mock("./hasura", () => ({ hasura: vi.fn() }));

import { hasura } from "./hasura";
import { importInvoicesRows } from "./csvImport";

const VENDOR_ID = "11111111-1111-1111-1111-111111111111";

function mockHasuraSequence(existingKeys: string[], insertAffectedRows: number) {
  vi.mocked(hasura).mockImplementation(async (query: string) => {
    if (query.includes("vendors { id }")) return { vendors: [{ id: VENDOR_ID }] } as any;
    if (query.includes("invoices(limit: 10000)")) {
      return {
        invoices: existingKeys.map((k) => {
          const [vendor_id, invoice_number] = k.split("|");
          return { vendor_id, invoice_number };
        }),
      } as any;
    }
    return { insert_invoices: { affected_rows: insertAffectedRows } } as any;
  });
}

const row = (invoiceNumber: string) => ({
  invoiceNumber,
  vendorId: VENDOR_ID,
  direction: "PAYABLE",
  invoiceDate: "2024-01-01",
  dueDate: "2024-01-31",
  amount: 100,
  taxAmount: 0,
  department: "IT",
  source: "csv",
});

describe("importInvoicesRows dedup", () => {
  it("skips a row that collides with an existing invoice for the same vendor", async () => {
    mockHasuraSequence([`${VENDOR_ID}|INV-1`], 0);
    const result = await importInvoicesRows("company-a", [row("INV-1")]);
    expect(result.created).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0].message).toMatch(/Duplicate invoice/);
  });

  it("skips the second of two rows in the same batch sharing a vendor+invoice number", async () => {
    mockHasuraSequence([], 1);
    const result = await importInvoicesRows("company-a", [row("INV-2"), row("INV-2")]);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].row).toBe(2);
  });

  it("imports a row whose vendor+invoice number key is new", async () => {
    mockHasuraSequence([`${VENDOR_ID}|INV-OTHER`], 1);
    const result = await importInvoicesRows("company-a", [row("INV-3")]);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
  });
});
