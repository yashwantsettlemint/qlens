CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  tax_id TEXT,
  payment_terms_days INT DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT NOT NULL,
  vendor_id UUID REFERENCES vendors(id),
  amount NUMERIC(14,2) NOT NULL,
  department TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL,
  vendor_id UUID REFERENCES vendors(id) NOT NULL,
  po_id UUID REFERENCES purchase_orders(id),
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  tax_amount NUMERIC(14,2) DEFAULT 0,
  department TEXT NOT NULL,
  approval_status TEXT DEFAULT 'pending',
  payment_status TEXT DEFAULT 'unpaid',
  source TEXT DEFAULT 'manual',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT,
  quantity NUMERIC,
  unit_price NUMERIC(14,2),
  line_amount NUMERIC(14,2)
);

CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  approver TEXT NOT NULL,
  level INT NOT NULL,
  status TEXT DEFAULT 'pending',
  acted_at TIMESTAMPTZ
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  paid_at TIMESTAMPTZ,
  amount_paid NUMERIC(14,2)
);

CREATE TABLE duplicate_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  matched_invoice_id UUID REFERENCES invoices(id),
  confidence_score NUMERIC(5,4),
  method TEXT,
  reviewed_status TEXT DEFAULT 'unreviewed',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE delay_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  delay_probability NUMERIC(5,4),
  predicted_delay_days INT,
  model_version TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- vendor-wise exposure, read directly by the dashboard
CREATE VIEW vendor_exposure AS
SELECT vendor_id, payment_status, SUM(amount) AS total_amount, COUNT(*) AS invoice_count
FROM invoices
GROUP BY vendor_id, payment_status;

-- indexes the dashboard / overdue-sweep / ml lookups actually hit
CREATE INDEX idx_invoices_vendor_id ON invoices (vendor_id);
CREATE INDEX idx_invoices_payment_due ON invoices (payment_status, due_date);
CREATE INDEX idx_invoices_approval_status ON invoices (approval_status);
CREATE INDEX idx_duplicate_flags_invoice_id ON duplicate_flags (invoice_id);
CREATE INDEX idx_delay_predictions_invoice_id ON delay_predictions (invoice_id);
CREATE INDEX idx_approvals_invoice_id ON approvals (invoice_id);
CREATE INDEX idx_payments_invoice_id ON payments (invoice_id);
