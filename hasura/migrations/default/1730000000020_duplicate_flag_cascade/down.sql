ALTER TABLE duplicate_flags
  DROP CONSTRAINT duplicate_flags_matched_invoice_id_fkey;

ALTER TABLE duplicate_flags
  ADD CONSTRAINT duplicate_flags_matched_invoice_id_fkey
  FOREIGN KEY (matched_invoice_id) REFERENCES invoices(id);
