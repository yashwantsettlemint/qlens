ALTER TABLE invoice_line_items DROP COLUMN unit;
ALTER TABLE invoice_line_items DROP COLUMN gst_rate;
ALTER TABLE invoice_line_items DROP COLUMN hsn_sac;
ALTER TABLE invoice_line_items DROP COLUMN note;

ALTER TABLE customers DROP COLUMN state;
ALTER TABLE customers DROP COLUMN address;
ALTER TABLE customers DROP COLUMN gstin;

ALTER TABLE companies DROP COLUMN bank_swift;
ALTER TABLE companies DROP COLUMN bank_ifsc;
ALTER TABLE companies DROP COLUMN bank_account_number;
ALTER TABLE companies DROP COLUMN bank_name;
ALTER TABLE companies DROP COLUMN bank_account_name;
ALTER TABLE companies DROP COLUMN state;
ALTER TABLE companies DROP COLUMN address;
ALTER TABLE companies DROP COLUMN pan;
ALTER TABLE companies DROP COLUMN gstin;
