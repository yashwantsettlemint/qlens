DROP FUNCTION upsert_invoice_embedding(uuid, text, text, uuid);
CREATE FUNCTION upsert_invoice_embedding(
  p_invoice_id uuid,
  p_chunk_text text,
  p_embedding  text
)
RETURNS SETOF invoice_embeddings
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO invoice_embeddings (invoice_id, chunk_text, embedding, created_at)
  VALUES (p_invoice_id, p_chunk_text, p_embedding::vector, now())
  ON CONFLICT (invoice_id) DO UPDATE
    SET chunk_text = EXCLUDED.chunk_text,
        embedding  = EXCLUDED.embedding,
        created_at = now()
  RETURNING *;
END;
$$;

DROP FUNCTION match_invoice_embeddings(text, integer, uuid);
CREATE FUNCTION match_invoice_embeddings(query_embedding text, match_count integer DEFAULT 5)
RETURNS SETOF invoice_embedding_match
LANGUAGE sql
STABLE
AS $$
  SELECT e.invoice_id,
         e.chunk_text,
         1 - (e.embedding <=> query_embedding::vector) AS similarity
  FROM invoice_embeddings e
  WHERE e.embedding IS NOT NULL
  ORDER BY e.embedding <=> query_embedding::vector
  LIMIT GREATEST(match_count, 1)
$$;

ALTER TABLE invoice_embedding_match DROP COLUMN company_id;

DROP VIEW customer_exposure;
DROP VIEW vendor_exposure;
CREATE VIEW vendor_exposure AS
SELECT vendor_id, payment_status, SUM(amount) AS total_amount, COUNT(*) AS invoice_count
FROM invoices
WHERE direction = 'payable'
GROUP BY vendor_id, payment_status;
CREATE VIEW customer_exposure AS
SELECT customer_id, payment_status, SUM(amount) AS total_amount, COUNT(*) AS invoice_count
FROM invoices
WHERE direction = 'receivable'
GROUP BY customer_id, payment_status;

ALTER TABLE invoice_embeddings DROP COLUMN company_id;
ALTER TABLE delay_predictions DROP COLUMN company_id;
ALTER TABLE duplicate_flags DROP COLUMN company_id;
ALTER TABLE payments DROP COLUMN company_id;
ALTER TABLE approvals DROP COLUMN company_id;
ALTER TABLE invoice_line_items DROP COLUMN company_id;
ALTER TABLE invoices DROP COLUMN company_id;
ALTER TABLE purchase_orders DROP COLUMN company_id;
ALTER TABLE customers DROP COLUMN company_id;
ALTER TABLE vendors DROP COLUMN company_id;

DROP TABLE invites;
DROP TABLE users;

CREATE TABLE company_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO company_settings (id, name, aliases)
SELECT 'default', name, aliases FROM companies LIMIT 1;

DROP TABLE companies;
