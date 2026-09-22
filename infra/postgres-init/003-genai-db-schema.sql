-- Schema for genai_db (created by 002-create-genai-db.sh). Runs against
-- $POSTGRES_DB by default under docker-entrypoint-initdb.d, hence the
-- explicit \connect. Mirrors the invoice_embeddings table that used to live
-- in the shared invoice_tracker DB (hasura/migrations/default/1730000000002,
-- 1730000000013, 1730000000015) — invoice_id/company_id FKs are dropped since
-- Postgres FKs can't cross databases; company_id is still a plain column, so
-- tenant filtering is unaffected.
\connect genai_db

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE invoice_embeddings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID NOT NULL,
  chunk_text  TEXT NOT NULL,
  embedding   vector(384),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  company_id  UUID NOT NULL,
  chunk_index INT NOT NULL DEFAULT 0,
  UNIQUE (invoice_id, chunk_index)
);
CREATE INDEX idx_invoice_embeddings_company ON invoice_embeddings (company_id);
CREATE INDEX invoice_embeddings_hnsw ON invoice_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE FUNCTION match_invoice_embeddings(
  query_embedding text,
  match_count integer,
  for_company_id uuid
)
RETURNS TABLE(invoice_id uuid, chunk_text text, similarity double precision, company_id uuid, chunk_index int)
LANGUAGE sql
STABLE
AS $$
  SELECT e.invoice_id,
         e.chunk_text,
         1 - (e.embedding <=> query_embedding::vector) AS similarity,
         e.company_id,
         e.chunk_index
  FROM invoice_embeddings e
  WHERE e.embedding IS NOT NULL
    AND e.company_id = for_company_id
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
    SET chunk_text = EXCLUDED.chunk_text,
        embedding  = EXCLUDED.embedding,
        created_at = now()
  RETURNING *;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'genai_service') THEN
    CREATE ROLE genai_service LOGIN PASSWORD 'postgrespassword';
  END IF;
END
$$;
GRANT CONNECT ON DATABASE genai_db TO genai_service;
GRANT USAGE ON SCHEMA public TO genai_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_embeddings TO genai_service;
GRANT EXECUTE ON FUNCTION match_invoice_embeddings(text, integer, uuid) TO genai_service;
GRANT EXECUTE ON FUNCTION upsert_invoice_embedding(uuid, int, text, text, uuid) TO genai_service;
