-- Your company's own identity, admin-editable. ocr-service compares a
-- document's vendor_name/buyer_name against this to tell payable from
-- receivable automatically (see services/ocr-service/app/match.py).
-- Single row, fixed id — there is exactly one "us".
CREATE TABLE company_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO company_settings (id, name) VALUES ('default', '');
