/** Filter/sort translation for the `invoices` query — pure, no I/O. */
import { TODAY, iso } from "./mappers";

export function buildWhere(f: any): Record<string, unknown> {
  const and: any[] = [];
  // Default to payables so every existing AP screen is unchanged; AR screens
  // pass direction: RECEIVABLE explicitly.
  and.push({ direction: { _eq: String(f?.direction ?? "PAYABLE").toLowerCase() } });
  if (!f) return { _and: and };
  if (f.vendorId) and.push({ vendor_id: { _eq: f.vendorId } });
  if (f.customerId) and.push({ customer_id: { _eq: f.customerId } });
  if (f.collectionStatus) and.push({ collection_status: { _eq: String(f.collectionStatus).toLowerCase() } });
  if (f.department) and.push({ department: { _eq: f.department } });
  if (f.source) and.push({ source: { _eq: f.source } });
  if (f.approvalStatus) and.push({ approval_status: { _eq: String(f.approvalStatus).toLowerCase() } });
  if (f.dateFrom) and.push({ invoice_date: { _gte: f.dateFrom } });
  if (f.dateTo) and.push({ invoice_date: { _lte: f.dateTo } });
  if (f.paymentStatus === "PAID") and.push({ payment_status: { _eq: "paid" } });
  if (f.paymentStatus === "OVERDUE")
    and.push({ payment_status: { _neq: "paid" } }, { due_date: { _lt: iso(TODAY) } });
  if (f.paymentStatus === "UNPAID")
    and.push({ payment_status: { _neq: "paid" } }, { due_date: { _gte: iso(TODAY) } });
  if (f.q)
    and.push({
      _or: [
        { invoice_number: { _ilike: `%${f.q}%` } },
        { vendor: { name: { _ilike: `%${f.q}%` } } },
        { customer: { name: { _ilike: `%${f.q}%` } } },
      ],
    });
  return and.length ? { _and: and } : {};
}

export function buildOrderBy(sort: any): Record<string, unknown> {
  const dir = sort?.dir === "DESC" ? "desc" : "asc";
  switch (sort?.field) {
    case "amount":
      return { amount: dir };
    case "vendor":
      return { vendor: { name: dir } };
    case "customer":
      return { customer: { name: dir } };
    case "collectionStatus":
      return { collection_status: dir };
    case "invoiceNumber":
      return { invoice_number: dir };
    case "invoiceDate":
      return { invoice_date: dir };
    case "department":
      return { department: dir };
    case "approvalStatus":
      return { approval_status: dir };
    case "paymentStatus":
      return { payment_status: dir };
    case "daysOverdue":
      // more overdue == older due date, so invert
      return { due_date: dir === "desc" ? "asc" : "desc" };
    case "delayProbability":
      return { delayPrediction: { delay_probability: `${dir}_nulls_last` } };
    case "dueDate":
    default:
      return { due_date: dir };
  }
}
