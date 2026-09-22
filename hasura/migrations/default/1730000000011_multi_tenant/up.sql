-- ============================================================================
-- Multi-tenant conversion.
--
-- `company_settings` (a single fixed row, "our company" for OCR
-- payable/receivable matching) becomes `companies` — one row per tenant, real
-- sign-up creates a new row. Every existing business table gets a
-- `company_id`, backfilled onto one seeded company ("Acme Traders", a fixed
-- id so it's easy to reference) so the current demo data and the old
-- hardcoded auth-service users keep working under one tenant.
--
-- `ml_drift_reports` / `ml_retrain_events` are deliberately left alone: they
-- describe the shared ML model's health, not any one tenant's data (see the
-- comment in 1730000000009_ml_ops/up.sql).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- crypt()/gen_salt('bf') to seed password hashes

-- ---------------------------------------------------------------------------
-- companies (replaces company_settings)
-- ---------------------------------------------------------------------------
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO companies (id, name, aliases)
VALUES ('00000000-0000-0000-0000-000000000001', 'Acme Traders', '{}');

DROP TABLE company_settings;

-- ---------------------------------------------------------------------------
-- users + invites — real, DB-backed accounts (replaces auth-service's
-- in-memory AUTH_USERS list).
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, username)
);

CREATE TABLE invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  invited_by TEXT, -- inviting user's username (JWTs identify users by username, not id)
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invites_company ON invites (company_id);
CREATE INDEX idx_invites_token ON invites (token);

-- Seed the old hardcoded demo users under Acme Traders — same usernames and
-- passwords as services/auth-service/app/users.py's _DEFAULT list.
INSERT INTO users (company_id, username, email, password_hash, role) VALUES
  ('00000000-0000-0000-0000-000000000001', 'kavya', 'kavya@acme.test', crypt('kavya', gen_salt('bf')), 'finance_user'),
  ('00000000-0000-0000-0000-000000000001', 'priya.nair', 'priya.nair@acme.test', crypt('priya', gen_salt('bf')), 'approver'),
  ('00000000-0000-0000-0000-000000000001', 'rahul.menon', 'rahul.menon@acme.test', crypt('rahul', gen_salt('bf')), 'approver'),
  ('00000000-0000-0000-0000-000000000001', 'anjali.rao', 'anjali.rao@acme.test', crypt('anjali', gen_salt('bf')), 'admin');

-- ---------------------------------------------------------------------------
-- company_id on every tenant-data table, backfilled to the seed company.
-- ---------------------------------------------------------------------------
ALTER TABLE vendors ADD COLUMN company_id UUID REFERENCES companies(id);
UPDATE vendors SET company_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE vendors ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_vendors_company ON vendors (company_id);

ALTER TABLE customers ADD COLUMN company_id UUID REFERENCES companies(id);
UPDATE customers SET company_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE customers ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_customers_company ON customers (company_id);

ALTER TABLE purchase_orders ADD COLUMN company_id UUID REFERENCES companies(id);
UPDATE purchase_orders SET company_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE purchase_orders ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_purchase_orders_company ON purchase_orders (company_id);

ALTER TABLE invoices ADD COLUMN company_id UUID REFERENCES companies(id);
UPDATE invoices SET company_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE invoices ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_invoices_company ON invoices (company_id);

ALTER TABLE invoice_line_items ADD COLUMN company_id UUID REFERENCES companies(id);
UPDATE invoice_line_items SET company_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE invoice_line_items ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_invoice_line_items_company ON invoice_line_items (company_id);

ALTER TABLE approvals ADD COLUMN company_id UUID REFERENCES companies(id);
UPDATE approvals SET company_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE approvals ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_approvals_company ON approvals (company_id);

ALTER TABLE payments ADD COLUMN company_id UUID REFERENCES companies(id);
UPDATE payments SET company_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE payments ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_payments_company ON payments (company_id);

ALTER TABLE duplicate_flags ADD COLUMN company_id UUID REFERENCES companies(id);
UPDATE duplicate_flags SET company_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE duplicate_flags ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_duplicate_flags_company ON duplicate_flags (company_id);

ALTER TABLE delay_predictions ADD COLUMN company_id UUID REFERENCES companies(id);
UPDATE delay_predictions SET company_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE delay_predictions ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_delay_predictions_company ON delay_predictions (company_id);

ALTER TABLE invoice_embeddings ADD COLUMN company_id UUID REFERENCES companies(id);
UPDATE invoice_embeddings SET company_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE invoice_embeddings ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_invoice_embeddings_company ON invoice_embeddings (company_id);

-- review_queue lives in a separate database (source "ocr", see
-- hasura/migrations/ocr/1730000000001_init_review_queue and
-- 1730000000008_drop_review_queue in this source) — not reachable from here,
-- so it isn't company-scoped by this migration. It's admin-secret-only today
-- (ocr-service writes it directly); scope it when it's exposed to a role.

-- vendor_exposure / customer_exposure are views over invoices — recreate with
-- company_id carried through so they stay tenant-scoped too.
DROP VIEW vendor_exposure;
CREATE VIEW vendor_exposure AS
SELECT company_id, vendor_id, payment_status, SUM(amount) AS total_amount, COUNT(*) AS invoice_count
FROM invoices
WHERE direction = 'payable'
GROUP BY company_id, vendor_id, payment_status;

DROP VIEW customer_exposure;
CREATE VIEW customer_exposure AS
SELECT company_id, customer_id, payment_status, SUM(amount) AS total_amount, COUNT(*) AS invoice_count
FROM invoices
WHERE direction = 'receivable'
GROUP BY company_id, customer_id, payment_status;

-- ---------------------------------------------------------------------------
-- invoice_embedding_match / match_invoice_embeddings / upsert_invoice_embedding
-- — the vector search is a global k-NN over invoice_embeddings, so without an
-- explicit company filter it would return other tenants' invoice text. Scope
-- it the same way the row-level tables are scoped.
-- ---------------------------------------------------------------------------
ALTER TABLE invoice_embedding_match ADD COLUMN company_id uuid;

DROP FUNCTION match_invoice_embeddings(text, integer);
CREATE FUNCTION match_invoice_embeddings(
  query_embedding text,
  match_count integer DEFAULT 5,
  for_company_id uuid DEFAULT NULL
)
RETURNS SETOF invoice_embedding_match
LANGUAGE sql
STABLE
AS $$
  SELECT e.invoice_id,
         e.chunk_text,
         1 - (e.embedding <=> query_embedding::vector) AS similarity,
         e.company_id
  FROM invoice_embeddings e
  WHERE e.embedding IS NOT NULL
    AND (for_company_id IS NULL OR e.company_id = for_company_id)
  ORDER BY e.embedding <=> query_embedding::vector
  LIMIT GREATEST(match_count, 1)
$$;

DROP FUNCTION upsert_invoice_embedding(uuid, text, text);
CREATE FUNCTION upsert_invoice_embedding(
  p_invoice_id uuid,
  p_chunk_text text,
  p_embedding  text,
  p_company_id uuid
)
RETURNS SETOF invoice_embeddings
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO invoice_embeddings (invoice_id, chunk_text, embedding, company_id, created_at)
  VALUES (p_invoice_id, p_chunk_text, p_embedding::vector, p_company_id, now())
  ON CONFLICT (invoice_id) DO UPDATE
    SET chunk_text = EXCLUDED.chunk_text,
        embedding  = EXCLUDED.embedding,
        created_at = now()
  RETURNING *;
END;
$$;
