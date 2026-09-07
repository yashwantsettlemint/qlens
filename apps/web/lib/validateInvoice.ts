import { DEPARTMENTS, INVOICE_SOURCES } from "./constants";

export interface InvoiceInputShape {
  invoiceNumber: string;
  vendorId: string;
  purchaseOrderId?: string | null;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  taxAmount: number;
  department: string;
  source: string;
}

/**
 * Row-level validation shared by manual entry, CSV import preview, and the mock
 * import resolver — so the preview shows exactly the errors a commit would hit.
 * Returns the first problem, or null when the row is valid.
 */
export function validateInvoiceInput(
  input: Partial<InvoiceInputShape>,
  knownVendorIds: Set<string>,
): string | null {
  if (!input.invoiceNumber || !String(input.invoiceNumber).trim())
    return "Invoice number is required";
  if (!input.vendorId || !knownVendorIds.has(input.vendorId))
    return "Vendor not recognised";
  if (!input.department || !DEPARTMENTS.includes(input.department as (typeof DEPARTMENTS)[number]))
    return `Department must be one of: ${DEPARTMENTS.join(", ")}`;
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "Amount must be a positive number";
  const tax = Number(input.taxAmount);
  if (!Number.isFinite(tax) || tax < 0) return "Tax amount must be zero or more";
  if (!input.invoiceDate || Number.isNaN(Date.parse(input.invoiceDate)))
    return "Invoice date is not a valid date (use YYYY-MM-DD)";
  if (!input.dueDate || Number.isNaN(Date.parse(input.dueDate)))
    return "Due date is not a valid date (use YYYY-MM-DD)";
  if (String(input.dueDate) < String(input.invoiceDate))
    return "Due date is before the invoice date";
  if (!INVOICE_SOURCES.includes(input.source as (typeof INVOICE_SOURCES)[number]))
    return `Source must be one of: ${INVOICE_SOURCES.join(", ")}`;
  return null;
}
