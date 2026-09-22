DROP FUNCTION upsert_invoice_embedding(uuid, int, text, text, uuid);
CREATE FUNCTION upsert_invoice_embedding(
  p_invoice_id uuid,
  p_chunk_text text,
  p_embedding  text,
  p_company_id uuid
)
RETURNS SETOF invoice_embeddings
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO invoice_embeddings (invoice_id, chunk_text, embedding, company_id, created_at)
  VALUES (p_invoice_id, p_chunk_text, p_embedding::vector, p_company_id, now())
  ON CONFLICT (invoice_id) DO UPDATE
    SET chunk_text = EXCLUDED.chunk_text,
        embedding  = EXCLUDED.embedding,
        created_at = now()
  RETURNING *;
END;
$$;

DROP FUNCTION match_invoice_embeddings(text, integer, uuid);
CREATE FUNCTION match_invoice_embeddings(
  query_embedding text,
  match_count integer,
  for_company_id uuid
)
RETURNS SETOF invoice_embedding_match
LANGUAGE sql
STABLE
AS $$
  SELECT e.invoice_id,
         e.chunk_text,
         1 - (e.embedding <=> query_embedding::vector) AS similarity,
         e.company_id
  FROM invoice_embeddings e
  WHERE e.embedding IS NOT NULL
    AND e.company_id = for_company_id
  ORDER BY e.embedding <=> query_embedding::vector
  LIMIT GREATEST(match_count, 1)
$$;

ALTER TABLE invoice_embedding_match DROP COLUMN chunk_index;

-- Only safe if every invoice still has exactly one chunk row — a real
-- rollback after multi-chunk data exists needs a manual de-dup pass first.
DELETE FROM invoice_embeddings a USING invoice_embeddings b
  WHERE a.invoice_id = b.invoice_id AND a.chunk_index < b.chunk_index;
ALTER TABLE invoice_embeddings DROP CONSTRAINT invoice_embeddings_invoice_chunk_key;
ALTER TABLE invoice_embeddings DROP COLUMN chunk_index;
ALTER TABLE invoice_embeddings ADD CONSTRAINT invoice_embeddings_invoice_id_key UNIQUE (invoice_id);
