CREATE TABLE review_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_draft JSONB NOT NULL,
  issues        TEXT[] NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | committed | rejected
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_review_queue_status ON review_queue (status, created_at DESC);
