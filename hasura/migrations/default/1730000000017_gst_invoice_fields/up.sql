-- Full GST tax-invoice format for generated outbound invoices: per-line
-- HSN/SAC + GST rate, company/customer GSTIN/PAN/address/state (state
-- comparison drives CGST+SGST vs IGST), and company bank details. All
-- nullable — an invoice generated before these are filled in just omits
-- that part of the document, same as the signature block already does.

ALTER TABLE companies ADD COLUMN gstin TEXT;
ALTER TABLE companies ADD COLUMN pan TEXT;
ALTER TABLE companies ADD COLUMN address TEXT;
ALTER TABLE companies ADD COLUMN state TEXT;
ALTER TABLE companies ADD COLUMN bank_account_name TEXT;
ALTER TABLE companies ADD COLUMN bank_name TEXT;
ALTER TABLE companies ADD COLUMN bank_account_number TEXT;
ALTER TABLE companies ADD COLUMN bank_ifsc TEXT;
ALTER TABLE companies ADD COLUMN bank_swift TEXT;

ALTER TABLE customers ADD COLUMN gstin TEXT;
ALTER TABLE customers ADD COLUMN address TEXT;
ALTER TABLE customers ADD COLUMN state TEXT;

ALTER TABLE invoice_line_items ADD COLUMN note TEXT;
ALTER TABLE invoice_line_items ADD COLUMN hsn_sac TEXT;
ALTER TABLE invoice_line_items ADD COLUMN gst_rate NUMERIC;
ALTER TABLE invoice_line_items ADD COLUMN unit TEXT NOT NULL DEFAULT 'Units';
