DROP VIEW customer_exposure;
DROP VIEW vendor_exposure;
CREATE VIEW vendor_exposure AS
SELECT vendor_id, payment_status, SUM(amount) AS total_amount, COUNT(*) AS invoice_count
FROM invoices
GROUP BY vendor_id, payment_status;

DELETE FROM invoices WHERE direction = 'receivable';
ALTER TABLE invoices DROP CONSTRAINT invoices_party_ck;
DROP INDEX idx_invoices_customer_id;
DROP INDEX idx_invoices_direction;
ALTER TABLE invoices ALTER COLUMN vendor_id SET NOT NULL;
ALTER TABLE invoices
  DROP COLUMN collection_status,
  DROP COLUMN customer_id,
  DROP COLUMN direction;

DROP TABLE customers;
