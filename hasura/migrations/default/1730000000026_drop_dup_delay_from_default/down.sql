-- Rollback: recreate the tables this migration dropped, matching their
-- shape from 1730000000000_init/1730000000011_multi_tenant/
-- 1730000000020_duplicate_flag_cascade. Does NOT restore data — restore
-- from a backup or re-copy from ml_db if rolling back for real.
CREATE TABLE duplicate_flags (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         UUID REFERENCES invoices(id) ON DELETE CASCADE,
  matched_invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  confidence_score   NUMERIC(5,4),
  method             TEXT,
  reviewed_status    TEXT DEFAULT 'unreviewed',
  created_at         TIMESTAMPTZ DEFAULT now(),
  explanation        JSONB,
  reason             TEXT,
  company_id         UUID NOT NULL REFERENCES companies(id)
);
CREATE INDEX idx_duplicate_flags_company ON duplicate_flags (company_id);
CREATE INDEX idx_duplicate_flags_invoice_id ON duplicate_flags (invoice_id);

CREATE TABLE delay_predictions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id           UUID REFERENCES invoices(id) ON DELETE CASCADE,
  delay_probability    NUMERIC(5,4),
  predicted_delay_days INTEGER,
  model_version        TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  explanation          JSONB,
  company_id           UUID NOT NULL REFERENCES companies(id)
);
CREATE INDEX idx_delay_predictions_company ON delay_predictions (company_id);
CREATE INDEX idx_delay_predictions_invoice_id ON delay_predictions (invoice_id);
