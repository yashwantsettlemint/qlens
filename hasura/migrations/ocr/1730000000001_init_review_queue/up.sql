-- ocr-service's own database: low-confidence OCR drafts land here instead of
-- `invoices` (which lives in the "default" source's database).
-- IF NOT EXISTS: this database was seeded by copying the pre-split table+data
-- over from "default" (see infra migration notes), so on the live deployment
-- this table already exists when the migration first runs here.
CREATE TABLE IF NOT EXISTS review_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_draft JSONB NOT NULL,
  issues        TEXT[] NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | committed | rejected
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue (status, created_at DESC);
