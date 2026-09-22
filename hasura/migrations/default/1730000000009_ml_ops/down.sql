DROP TABLE IF EXISTS ml_retrain_events;
DROP TABLE IF EXISTS ml_drift_reports;
ALTER TABLE duplicate_flags DROP COLUMN IF EXISTS explanation;
ALTER TABLE delay_predictions DROP COLUMN IF EXISTS explanation;
ALTER TABLE duplicate_flags DROP COLUMN IF EXISTS reason;
