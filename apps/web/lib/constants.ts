export const DEPARTMENTS = [
  "Procurement",
  "IT",
  "Facilities",
  "Marketing",
  "Logistics",
  "HR",
] as const;

export const INVOICE_SOURCES = ["manual", "csv", "ocr"] as const;

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export const PAYMENT_STATUSES = ["UNPAID", "PAID", "OVERDUE"] as const;

export const PAGE_SIZE = 25;
