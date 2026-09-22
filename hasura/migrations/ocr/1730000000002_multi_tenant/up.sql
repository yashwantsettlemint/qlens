-- review_queue lives in its own physical database (ocr_db), separate from
-- the "default" source where `companies` lives — so this is a plain column,
-- not a foreign key (cross-database FKs aren't a thing in Postgres).
-- Backfilled to the same seed company id as hasura/migrations/default's
-- 1730000000011_multi_tenant, for the same reason: the existing demo data
-- keeps working under one tenant.
ALTER TABLE review_queue ADD COLUMN company_id UUID;
UPDATE review_queue SET company_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE review_queue ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_review_queue_company ON review_queue (company_id);
