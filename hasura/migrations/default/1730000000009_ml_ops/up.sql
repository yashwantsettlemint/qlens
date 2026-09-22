-- Explainability: the hand-written duplicate `reason` string (already computed
-- by duplicates.py but never persisted) plus structured, model-derived
-- contributions backing both it and the delay prediction.
ALTER TABLE duplicate_flags ADD COLUMN reason TEXT;
ALTER TABLE delay_predictions ADD COLUMN explanation JSONB;
ALTER TABLE duplicate_flags ADD COLUMN explanation JSONB;

-- Drift detection + retraining audit trail. Admin-only (read via the BFF's
-- admin secret, like company_settings) — no per-role select_permissions.
CREATE TABLE ml_drift_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  drift_detected BOOLEAN NOT NULL,
  feature_psi JSONB,
  rolling_metrics JSONB,
  baseline_metrics JSONB,
  notes TEXT
);

CREATE TABLE ml_retrain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name TEXT NOT NULL,
  triggered_by TEXT NOT NULL, -- 'drift' | 'manual' | 'schedule'
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  old_version TEXT,
  new_version TEXT,
  old_metrics JSONB,
  new_metrics JSONB,
  error TEXT
);

CREATE INDEX idx_ml_drift_reports_model_checked ON ml_drift_reports (model_name, checked_at DESC);
CREATE INDEX idx_ml_retrain_events_model_started ON ml_retrain_events (model_name, started_at DESC);
