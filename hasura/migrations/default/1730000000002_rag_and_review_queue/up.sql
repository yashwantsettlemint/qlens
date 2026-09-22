-- pgvector-backed invoice RAG + the OCR review queue.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- review_queue — low-confidence OCR drafts land here instead of `invoices`.
-- ---------------------------------------------------------------------------
CREATE TABLE review_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_draft JSONB NOT NULL,
  issues        TEXT[] NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | committed | rejected
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_review_queue_status ON review_queue (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- invoice_embeddings — one row per invoice, (re)built by genai-service /embed.
-- ---------------------------------------------------------------------------
CREATE TABLE invoice_embeddings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE CASCADE,
  chunk_text TEXT NOT NULL,
  embedding  vector(384),                          -- all-MiniLM-L6-v2
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invoice_embeddings_hnsw
  ON invoice_embeddings USING hnsw (embedding vector_cosine_ops);

-- Return type for the search function. Never written to directly — it exists so
-- Hasura can track the function *and* expose `similarity` alongside the row.
CREATE TABLE invoice_embedding_match (
  invoice_id uuid,
  chunk_text text,
  similarity double precision
);

-- ---------------------------------------------------------------------------
-- match_invoice_embeddings(query, k) — cosine top-k, callable via Hasura as
-- genai_readonly. The query vector comes in as text (a '[.. , ..]' literal) so
-- Hasura never has to model the `vector` type on the wire; cast happens here.
-- ---------------------------------------------------------------------------
CREATE FUNCTION match_invoice_embeddings(query_embedding text, match_count integer DEFAULT 5)
RETURNS SETOF invoice_embedding_match
LANGUAGE sql
STABLE
AS $$
  SELECT e.invoice_id,
         e.chunk_text,
         1 - (e.embedding <=> query_embedding::vector) AS similarity
  FROM invoice_embeddings e
  WHERE e.embedding IS NOT NULL
  ORDER BY e.embedding <=> query_embedding::vector
  LIMIT GREATEST(match_count, 1)
$$;

-- ---------------------------------------------------------------------------
-- upsert_invoice_embedding(...) — write path for genai-service /embed (admin).
-- text arg + internal cast, same reasoning as above.
-- ---------------------------------------------------------------------------
CREATE FUNCTION upsert_invoice_embedding(
  p_invoice_id uuid,
  p_chunk_text text,
  p_embedding  text
)
RETURNS SETOF invoice_embeddings
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO invoice_embeddings (invoice_id, chunk_text, embedding, created_at)
  VALUES (p_invoice_id, p_chunk_text, p_embedding::vector, now())
  ON CONFLICT (invoice_id) DO UPDATE
    SET chunk_text = EXCLUDED.chunk_text,
        embedding  = EXCLUDED.embedding,
        created_at = now()
  RETURNING *;
END;
$$;
