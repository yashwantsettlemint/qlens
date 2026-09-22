-- Deactivate a teammate instead of only ever creating new ones — a
-- deactivated user can no longer authenticate but their history (approvals,
-- invoices created_by, etc.) stays intact.
ALTER TABLE users ADD COLUMN is_active boolean NOT NULL DEFAULT true;
