-- A long invoice (multi-page OCR text) was being embedded as a single
-- vector, silently truncated at the embedding model's ~256-token limit —
-- content past roughly the first page never made it into the vector at
-- all. Move to multiple chunks per invoice: one short structured-summary
-- chunk (as before) plus one chunk per overlapping window of the extracted
-- document text, so a 7-10 page invoice is actually fully searchable.

ALTER TABLE invoice_embeddings DROP CONSTRAINT invoice_embeddings_invoice_id_key;
ALTER TABLE invoice_embeddings ADD COLUMN chunk_index INT NOT NULL DEFAULT 0;
ALTER TABLE invoice_embeddings ADD CONSTRAINT invoice_embeddings_invoice_chunk_key
  UNIQUE (invoice_id, chunk_index);

ALTER TABLE invoice_embedding_match ADD COLUMN chunk_index int;

-- match_invoice_embeddings now naturally returns multiple rows per invoice
-- (one per matching chunk) since invoice_embeddings can have several rows
-- per invoice_id — the ranking logic itself doesn't change, just what it's
-- ranking over. Adds chunk_index to the result so callers can tell which
-- part of the document matched.
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
         e.company_id,
         e.chunk_index
  FROM invoice_embeddings e
  WHERE e.embedding IS NOT NULL
    AND e.company_id = for_company_id
  ORDER BY e.embedding <=> query_embedding::vector
  LIMIT GREATEST(match_count, 1)
$$;

-- One row per (invoice, chunk) now, not one row per invoice — takes
-- chunk_index explicitly and no longer needs ON CONFLICT DO UPDATE, since
-- the caller (genai-service) deletes an invoice's existing chunk rows
-- before re-inserting the fresh set on every re-embed.
DROP FUNCTION upsert_invoice_embedding(uuid, text, text, uuid);
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
