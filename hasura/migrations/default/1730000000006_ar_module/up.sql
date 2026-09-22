-- Accounts-receivable module: customers + receivable-direction invoices.
-- One invoices table, discriminated by `direction`:
--   payable    -> money out, has vendor_id   (today's behaviour, the default)
--   receivable -> money in,  has customer_id, uses collection_status not approval
-- Receipts reuse the payments table (a receipt is a payment against a receivable).

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  tax_id TEXT,
  email TEXT,
  payment_terms_days INT DEFAULT 30,
  credit_limit NUMERIC(14,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE invoices
  ADD COLUMN direction TEXT NOT NULL DEFAULT 'payable',
  ADD COLUMN customer_id UUID REFERENCES customers(id),
  ADD COLUMN collection_status TEXT;  -- receivable-only: draft | sent | disputed | settled

-- vendor_id was NOT NULL; a receivable has a customer instead.
ALTER TABLE invoices ALTER COLUMN vendor_id DROP NOT NULL;

ALTER TABLE invoices ADD CONSTRAINT invoices_party_ck CHECK (
  (direction = 'payable'    AND vendor_id   IS NOT NULL AND customer_id IS NULL) OR
  (direction = 'receivable' AND customer_id IS NOT NULL AND vendor_id   IS NULL)
);

CREATE INDEX idx_invoices_direction ON invoices (direction);
CREATE INDEX idx_invoices_customer_id ON invoices (customer_id);

-- vendor_exposure now has to exclude receivables.
DROP VIEW vendor_exposure;
CREATE VIEW vendor_exposure AS
SELECT vendor_id, payment_status, SUM(amount) AS total_amount, COUNT(*) AS invoice_count
FROM invoices
WHERE direction = 'payable'
GROUP BY vendor_id, payment_status;

-- customer-wise exposure, the AR mirror of vendor_exposure.
CREATE VIEW customer_exposure AS
SELECT customer_id, payment_status, SUM(amount) AS total_amount, COUNT(*) AS invoice_count
FROM invoices
WHERE direction = 'receivable'
GROUP BY customer_id, payment_status;
