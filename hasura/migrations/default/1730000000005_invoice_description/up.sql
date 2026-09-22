-- Free-text "what this invoice is about" — set on manual entry / CSV import.
ALTER TABLE invoices ADD COLUMN description text;
