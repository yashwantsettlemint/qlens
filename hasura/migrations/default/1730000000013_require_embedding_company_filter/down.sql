DROP FUNCTION match_invoice_embeddings(text, integer, uuid);
CREATE FUNCTION match_invoice_embeddings(
  query_embedding text,
  match_count integer DEFAULT 5,
  for_company_id uuid DEFAULT NULL
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
    AND (for_company_id IS NULL OR e.company_id = for_company_id)
  ORDER BY e.embedding <=> query_embedding::vector
  LIMIT GREATEST(match_count, 1)
$$;
