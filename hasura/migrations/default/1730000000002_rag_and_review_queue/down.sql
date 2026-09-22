DROP FUNCTION IF EXISTS upsert_invoice_embedding(uuid, text, text);
DROP FUNCTION IF EXISTS match_invoice_embeddings(text, integer);
DROP TABLE IF EXISTS invoice_embedding_match;
DROP TABLE IF EXISTS invoice_embeddings;
DROP TABLE IF EXISTS review_queue;
-- `vector` extension is left in place.
