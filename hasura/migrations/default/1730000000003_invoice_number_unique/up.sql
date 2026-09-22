-- A vendor never has two invoices with the same number. This is the backstop —
-- no service can insert a duplicate, whatever the app-level checks do.

-- Drop any pre-existing duplicates first (keep the earliest row of each group).
DELETE FROM invoices a
USING invoices b
WHERE a.ctid > b.ctid
  AND a.vendor_id = b.vendor_id
  AND a.invoice_number = b.invoice_number;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_vendor_number_key UNIQUE (vendor_id, invoice_number);
