-- Raw OCR-extracted text, kept at commit time so genai-service can embed the
-- whole document, not just the handful of structured columns.
ALTER TABLE invoices ADD COLUMN extracted_text text;
