-- match_invoice_embeddings() previously let for_company_id default to NULL,
-- which the WHERE clause treated as "no filter — search every company."
-- Nothing calls it that way today (genai-service always passes it), but a
-- default that silently means "search everyone's data" is a bad default to
-- leave lying around. Make it required: a caller that omits it now gets a
-- hard Postgres error (missing argument), never a silent cross-tenant scan.
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
