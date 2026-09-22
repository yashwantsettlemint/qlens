-- Manual dummy dataset — NOT auto-run (only 1730000000001_seed.sql runs on
-- `docker compose up`, and that one is deliberately empty). Run this by hand
-- whenever you want sample data, e.g. after a TRUNCATE. See README for how.

INSERT INTO company_settings (id, name, aliases) VALUES
  ('default', 'Settlemint India Services Private Limited', ARRAY['settlemint india'])
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, aliases = EXCLUDED.aliases;

-- Vendors (payables side)
INSERT INTO vendors (id, name, tax_id, email, payment_terms_days) VALUES
  ('a1111111-0000-0000-0000-000000000001', 'Vertex Cables and Conduits', '27AAFCV1234A1Z5', 'ap@vertexcables.in', 30),
  ('a1111111-0000-0000-0000-000000000002', 'Ashwin Freight Movers', '29AAGCA5678B1Z2', 'accounts@ashwinfreight.in', 15),
  ('a1111111-0000-0000-0000-000000000003', 'Ramanuja Steel Traders', '33AAHCR9012C1Z8', 'billing@ramanujasteel.in', 45),
  ('a1111111-0000-0000-0000-000000000004', 'Sundaram Power Controls', '06AAICS3456D1Z1', 'finance@sundarampower.in', 30),
  ('a1111111-0000-0000-0000-000000000005', 'Meridian Testing Labs', '19AAJCM7890E1Z4', 'ap@meridianlabs.in', 30)
ON CONFLICT (id) DO NOTHING;

-- Customers (receivables side)
INSERT INTO customers (id, name, tax_id, email, payment_terms_days, credit_limit) VALUES
  ('b2222222-0000-0000-0000-000000000001', 'State Bank of India, IT-Internet Banking Department', '27AAACS8577K5ZL', 'ap@sbi.co.in', 30, 5000000),
  ('b2222222-0000-0000-0000-000000000002', 'Zensar Technologies', '27AAACZ1234F1ZQ', 'payables@zensar.com', 45, 3000000),
  ('b2222222-0000-0000-0000-000000000003', 'Larsen and Toubro Infotech', '27AAACL5678G1ZR', 'finance@ltimindtree.com', 30, 4000000),
  ('b2222222-0000-0000-0000-000000000004', 'Reliance Retail Ventures', '27AAACR9012H1ZS', 'ap@relianceretail.com', 60, 8000000)
ON CONFLICT (id) DO NOTHING;

-- Payable invoices — mix of pending/approved, paid/unpaid/overdue
INSERT INTO invoices (id, invoice_number, vendor_id, invoice_date, due_date, amount, tax_amount, department, approval_status, payment_status, source, direction) VALUES
  ('c3333333-0000-0000-0000-000000000001', 'VER/2526/108', 'a1111111-0000-0000-0000-000000000001', CURRENT_DATE - 40, CURRENT_DATE - 10, 2100000, 240000, 'Logistics', 'approved', 'paid', 'manual', 'payable'),
  ('c3333333-0000-0000-0000-000000000002', 'ASH/2526/109', 'a1111111-0000-0000-0000-000000000002', CURRENT_DATE - 30, CURRENT_DATE - 15, 480000, 57200, 'Logistics', 'pending', 'unpaid', 'manual', 'payable'),
  ('c3333333-0000-0000-0000-000000000003', 'RAM/2526/107', 'a1111111-0000-0000-0000-000000000003', CURRENT_DATE - 60, CURRENT_DATE - 15, 640000, 73000, 'Facilities', 'pending', 'unpaid', 'manual', 'payable'),
  ('c3333333-0000-0000-0000-000000000004', 'SUN/2526/106', 'a1111111-0000-0000-0000-000000000004', CURRENT_DATE - 50, CURRENT_DATE - 20, 500000, 58000, 'IT', 'pending', 'unpaid', 'manual', 'payable'),
  ('c3333333-0000-0000-0000-000000000005', 'MER252W110', 'a1111111-0000-0000-0000-000000000005', CURRENT_DATE - 20, CURRENT_DATE - 5, 370000, 44800, 'IT', 'pending', 'unpaid', 'manual', 'payable'),
  ('c3333333-0000-0000-0000-000000000006', 'VER/2526/112', 'a1111111-0000-0000-0000-000000000001', CURRENT_DATE - 5, CURRENT_DATE + 25, 1150000, 138000, 'Logistics', 'approved', 'unpaid', 'manual', 'payable'),
  ('c3333333-0000-0000-0000-000000000007', 'ASH/2526/113', 'a1111111-0000-0000-0000-000000000002', CURRENT_DATE - 2, CURRENT_DATE + 13, 210000, 25200, 'Logistics', 'approved', 'unpaid', 'manual', 'payable')
ON CONFLICT (id) DO NOTHING;

-- Receivable invoices — direction=receivable, customer_id set, vendor_id NULL.
-- ml-service scores delay predictions for these (receivables only).
INSERT INTO invoices (id, invoice_number, customer_id, invoice_date, due_date, amount, tax_amount, department, approval_status, payment_status, source, direction, description) VALUES
  ('d4444444-0000-0000-0000-000000000001', '2026-27/004', 'b2222222-0000-0000-0000-000000000001', CURRENT_DATE - 130, CURRENT_DATE - 100, 2343000, 421740, 'IT', 'approved', 'unpaid', 'manual', 'receivable', 'Kubernetes / DevOps engineering services, April 2026'),
  ('d4444444-0000-0000-0000-000000000002', 'ZEN/26-27/0042', 'b2222222-0000-0000-0000-000000000002', CURRENT_DATE - 60, CURRENT_DATE - 15, 850000, 153000, 'IT', 'approved', 'unpaid', 'manual', 'receivable', 'Cloud migration support, Q2'),
  ('d4444444-0000-0000-0000-000000000003', 'LTI/26-27/0089', 'b2222222-0000-0000-0000-000000000003', CURRENT_DATE - 45, CURRENT_DATE - 15, 620000, 111600, 'IT', 'approved', 'unpaid', 'manual', 'receivable', 'Staff augmentation, March 2026'),
  ('d4444444-0000-0000-0000-000000000004', 'REL/26-27/0210', 'b2222222-0000-0000-0000-000000000004', CURRENT_DATE - 20, CURRENT_DATE + 40, 4100000, 738000, 'IT', 'approved', 'unpaid', 'manual', 'receivable', 'Retail platform build, phase 2'),
  ('d4444444-0000-0000-0000-000000000005', 'ZEN/26-27/0051', 'b2222222-0000-0000-0000-000000000002', CURRENT_DATE - 10, CURRENT_DATE + 35, 390000, 70200, 'IT', 'approved', 'unpaid', 'manual', 'receivable', 'Support retainer, September'),
  ('d4444444-0000-0000-0000-000000000006', '2026-27/011', 'b2222222-0000-0000-0000-000000000001', CURRENT_DATE - 90, CURRENT_DATE - 60, 1800000, 324000, 'IT', 'approved', 'paid', 'manual', 'receivable', 'NoSQL DBA engagement, prior quarter')
ON CONFLICT (id) DO NOTHING;

-- Approvals for pending/approved invoices (level 1, actioned for the approved ones)
INSERT INTO approvals (invoice_id, approver, level, status, acted_at)
SELECT id, 'priya.nair', 1, 'approved', created_at + interval '2 days'
FROM invoices WHERE approval_status = 'approved'
ON CONFLICT DO NOTHING;

INSERT INTO approvals (invoice_id, approver, level, status)
SELECT id, 'priya.nair', 1, 'pending'
FROM invoices WHERE approval_status = 'pending'
ON CONFLICT DO NOTHING;

-- Payments for the two invoices marked paid
INSERT INTO payments (invoice_id, paid_at, amount_paid)
SELECT id, due_date::timestamptz - interval '2 days', amount + tax_amount
FROM invoices WHERE payment_status = 'paid'
ON CONFLICT DO NOTHING;
