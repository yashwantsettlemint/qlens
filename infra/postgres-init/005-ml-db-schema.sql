-- Schema for ml_db (created by 004-create-ml-db.sh). Mirrors the
-- ml_drift_reports/ml_retrain_events tables that used to live in the shared
-- invoice_tracker DB (hasura/migrations/default/1730000000009_ml_ops,
-- 1730000000012_ml_per_company). Neither table had an FK to invoices, so
-- this is a clean move.
\connect ml_db

CREATE TABLE ml_drift_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name       TEXT NOT NULL,
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  drift_detected   BOOLEAN NOT NULL,
  feature_psi      JSONB,
  rolling_metrics  JSONB,
  baseline_metrics JSONB,
  notes            TEXT,
  company_id       UUID NOT NULL
);
CREATE INDEX idx_ml_drift_reports_company ON ml_drift_reports (company_id);
CREATE INDEX idx_ml_drift_reports_model_checked ON ml_drift_reports (model_name, checked_at DESC);

CREATE TABLE ml_retrain_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name   TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'running',
  old_version  TEXT,
  new_version  TEXT,
  old_metrics  JSONB,
  new_metrics  JSONB,
  error        TEXT,
  company_id   UUID NOT NULL
);
CREATE INDEX idx_ml_retrain_events_company ON ml_retrain_events (company_id);
CREATE INDEX idx_ml_retrain_events_model_started ON ml_retrain_events (model_name, started_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ml_service') THEN
    CREATE ROLE ml_service LOGIN PASSWORD 'postgrespassword';
  END IF;
END
$$;
GRANT CONNECT ON DATABASE ml_db TO ml_service;
GRANT USAGE ON SCHEMA public TO ml_service;
GRANT SELECT, INSERT, UPDATE ON ml_drift_reports, ml_retrain_events TO ml_service;
