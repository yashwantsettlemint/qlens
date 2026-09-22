-- Reverses the earlier decision (see 1730000000009_ml_ops's comment) to keep
-- these two tables global: the ML models became per-company, so drift
-- reports and retrain events are now a specific company's own history, not
-- shared ops data. No Hasura role permissions needed — both stay
-- admin-secret-only, read/written exclusively by ml-service's own
-- app/hasura.py.
ALTER TABLE ml_drift_reports ADD COLUMN company_id UUID REFERENCES companies(id);
UPDATE ml_drift_reports SET company_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE ml_drift_reports ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_ml_drift_reports_company ON ml_drift_reports (company_id);

ALTER TABLE ml_retrain_events ADD COLUMN company_id UUID REFERENCES companies(id);
UPDATE ml_retrain_events SET company_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE ml_retrain_events ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_ml_retrain_events_company ON ml_retrain_events (company_id);
