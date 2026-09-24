/** CSV/bulk invoice import — row validation, in-batch + existing-row dedup,
 * and the shared insert-row shaper `toInsert` (also used by createInvoice in
 * server/resolvers.ts). Takes `companyId` as a plain argument — the caller
 * (a resolver) is responsible for auth/tenant gating before calling in. */
import { hasura } from "./hasura";
import { validateInvoiceInput } from "../lib/validateInvoice";

export function toInsert(input: any) {
  const direction = String(input.direction ?? "PAYABLE").toLowerCase();
  const o: Record<string, unknown> = {
    invoice_number: String(input.invoiceNumber),
    description: input.description ? String(input.description).trim() : null,
    extracted_text: input.extractedText ? String(input.extractedText) : null,
    direction,
    invoice_date: String(input.invoiceDate),
    due_date: String(input.dueDate),
    amount: Number(input.amount),
    tax_amount: Number(input.taxAmount ?? 0),
    department: String(input.department),
    source: ["manual", "csv", "ocr"].includes(input.source) ? input.source : "manual",
  };
  if (direction === "receivable") {
    if (!input.customerId) throw new Error("A receivable needs a customer");
    o.customer_id = String(input.customerId);
    o.collection_status = String(input.collectionStatus ?? "DRAFT").toLowerCase();
  } else {
    if (!input.vendorId) throw new Error("A payable needs a vendor");
    o.vendor_id = String(input.vendorId);
    if (input.purchaseOrderId) o.po_id = String(input.purchaseOrderId);
  }
  return o;
}

export async function importInvoicesRows(
  companyId: string,
  rows: any[],
): Promise<{ created: number; failed: number; errors: { row: number; message: string }[] }> {
  const vendorIds: Set<string> = new Set(
    (await hasura(`query { vendors { id } }`)).vendors.map((v: any) => v.id),
  );
  const existingKeys: Set<string> = new Set(
    (
      await hasura(`query { invoices(limit: 10000) { vendor_id invoice_number } }`)
    ).invoices.map((r: any) => `${r.vendor_id}|${r.invoice_number}`),
  );
  const errors: { row: number; message: string }[] = [];
  const valid: any[] = [];
  const seen = new Set<string>();
  rows.forEach((input, i) => {
    const problem = validateInvoiceInput(input, vendorIds);
    if (problem) {
      errors.push({ row: i + 1, message: problem });
      return;
    }
    const key = `${input.vendorId}|${String(input.invoiceNumber)}`;
    if (existingKeys.has(key) || seen.has(key)) {
      errors.push({
        row: i + 1,
        message: `Duplicate invoice "${input.invoiceNumber}" for this vendor — skipped`,
      });
      return;
    }
    seen.add(key);
    // No company_id field — the insert permission auto-fills it from the
    // session; companyId here is only the caller's no-session guard.
    valid.push(toInsert(input));
  });
  let created = 0;
  if (valid.length) {
    const data = await hasura(
      `mutation Import($o: [invoices_insert_input!]!) { insert_invoices(objects: $o) { affected_rows } }`,
      { o: valid },
    );
    created = data.insert_invoices.affected_rows;
  }
  return { created, failed: errors.length, errors };
}
