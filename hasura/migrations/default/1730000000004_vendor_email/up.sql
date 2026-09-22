-- Vendors get an optional contact email (for remittance / payment notices).
-- Admin sets it from the Vendors page; nothing enforces a value.
ALTER TABLE vendors ADD COLUMN email text;
