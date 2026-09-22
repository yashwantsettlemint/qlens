-- Supports generating and sending an outbound invoice document (template +
-- line items + digital signature) to a customer, in addition to every
-- other way an invoice can land in this app.
ALTER TABLE companies ADD COLUMN signature_data_url TEXT;
ALTER TABLE invoices ADD COLUMN template TEXT;
