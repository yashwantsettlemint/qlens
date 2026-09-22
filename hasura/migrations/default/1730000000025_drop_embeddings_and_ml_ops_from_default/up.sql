-- invoice_embeddings/invoice_embedding_match moved to genai-service's own
-- genai_db (see infra/postgres-init/002-003), and ml_drift_reports/
-- ml_retrain_events moved to ml-service's own ml_db (postgres-init/004-005).
-- Data was copied over and verified (row counts matched) before this ran.
-- duplicate_flags/delay_predictions are NOT touched here — they're joined
-- directly into the web app's invoice list query, moving them is a separate,
-- higher-risk decision (see the architecture plan's Phase 3).
DROP FUNCTION IF EXISTS match_invoice_embeddings(text, integer, uuid);
DROP FUNCTION IF EXISTS upsert_invoice_embedding(uuid, int, text, text, uuid);
DROP TABLE IF EXISTS invoice_embeddings;
DROP TABLE IF EXISTS invoice_embedding_match;
DROP TABLE IF EXISTS ml_drift_reports;
DROP TABLE IF EXISTS ml_retrain_events;
