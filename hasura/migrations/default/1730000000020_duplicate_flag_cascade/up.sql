-- A duplicate flag says "invoice A looks like invoice B". If either side is
-- deleted the flag is meaningless, so both FKs should cascade. Only invoice_id
-- did — deleting the *matched* invoice raised a FK violation and failed the
-- delete outright.
ALTER TABLE duplicate_flags
  DROP CONSTRAINT duplicate_flags_matched_invoice_id_fkey;

ALTER TABLE duplicate_flags
  ADD CONSTRAINT duplicate_flags_matched_invoice_id_fkey
  FOREIGN KEY (matched_invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
