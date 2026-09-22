-- Rollback: recreate the tables/functions this migration dropped, matching
-- their shape from 1730000000002/1730000000013/1730000000015 (embeddings)
-- and 1730000000009/1730000000012 (ml ops). Does NOT restore data — restore
-- from a backup or re-copy from genai_db/ml_db if rolling back for real.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE invoice_embeddings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  chunk_text  TEXT NOT NULL,
  embedding   vector(384),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  chunk_index INT NOT NULL DEFAULT 0,
  UNIQUE (invoice_id, chunk_index)
);
CREATE INDEX idx_invoice_embeddings_company ON invoice_embeddings (company_id);
CREATE INDEX invoice_embeddings_hnsw ON invoice_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE invoice_embedding_match (
  invoice_id uuid,
  chunk_text text,
  similarity double precision,
  company_id uuid,
  chunk_index int
);

CREATE FUNCTION match_invoice_embeddings(
  query_embedding text,
  match_count integer,
  for_company_id uuid
)
RETURNS SETOF invoice_embedding_match
LANGUAGE sql
STABLE
AS $$
  SELECT e.invoice_id, e.chunk_text,
         1 - (e.embedding <=> query_embedding::vector) AS similarity,
         e.company_id, e.chunk_index
  FROM invoice_embeddings e
  WHERE e.embedding IS NOT NULL AND e.company_id = for_company_id
  ORDER BY e.embedding <=> query_embedding::vector
  LIMIT GREATEST(match_count, 1)
$$;

CREATE FUNCTION upsert_invoice_embedding(
  p_invoice_id  uuid,
  p_chunk_index int,
  p_chunk_text  text,
  p_embedding   text,
  p_company_id  uuid
)
RETURNS SETOF invoice_embeddings
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO invoice_embeddings (invoice_id, chunk_index, chunk_text, embedding, company_id, created_at)
  VALUES (p_invoice_id, p_chunk_index, p_chunk_text, p_embedding::vector, p_company_id, now())
  ON CONFLICT (invoice_id, chunk_index) DO UPDATE
    SET chunk_text = EXCLUDED.chunk_text, embedding = EXCLUDED.embedding, created_at = now()
  RETURNING *;
END;
$$;

CREATE TABLE ml_drift_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name       TEXT NOT NULL,
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  drift_detected   BOOLEAN NOT NULL,
  feature_psi      JSONB,
  rolling_metrics  JSONB,
  baseline_metrics JSONB,
  notes            TEXT,
  company_id       UUID NOT NULL REFERENCES companies(id)
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
  company_id   UUID NOT NULL REFERENCES companies(id)
);
CREATE INDEX idx_ml_retrain_events_company ON ml_retrain_events (company_id);
CREATE INDEX idx_ml_retrain_events_model_started ON ml_retrain_events (model_name, started_at DESC);
