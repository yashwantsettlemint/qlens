-- Small demo dataset so every frontend screen shows data against real Hasura.
-- Fixed (hex) UUIDs keep relationships wired and the seed re-readable.
-- Truncate first so this is safe to re-run (compose `seed` one-shot, or `hasura seed apply`).

TRUNCATE vendors, purchase_orders, invoices, invoice_line_items,
         approvals, payments, duplicate_flags, delay_predictions RESTART IDENTITY CASCADE;

INSERT INTO vendors (id, name, tax_id, payment_terms_days) VALUES
  ('00000000-0000-0000-0000-0000000000a1'::uuid, 'Tata Consultancy Services', '27AAACT2727Q1ZW', 45),
  ('00000000-0000-0000-0000-0000000000a2'::uuid, 'Reliance Retail Ltd',       '27AAACR5055K1Z7', 30),
  ('00000000-0000-0000-0000-0000000000a3'::uuid, 'Infosys BPM Ltd',           '29AAACI4741P1ZL', 60),
  ('00000000-0000-0000-0000-0000000000a4'::uuid, 'Godrej & Boyce Mfg Co',     '27AAACG1234M1Z5', 45),
  ('00000000-0000-0000-0000-0000000000a5'::uuid, 'Asian Paints Ltd',          '27AAACA6666B1Z3', 30),
  ('00000000-0000-0000-0000-0000000000a6'::uuid, 'Havells India Ltd',         '09AAACH1234A1ZQ', 30),
  ('00000000-0000-0000-0000-0000000000a7'::uuid, 'Blue Dart Express Ltd',     '27AAACB0028P1ZT', 15),
  ('00000000-0000-0000-0000-0000000000a8'::uuid, 'Zensar Technologies Ltd',   '27AAACZ0987F1ZK', 45);

INSERT INTO purchase_orders (id, po_number, vendor_id, amount, department, status) VALUES
  ('00000000-0000-0000-0000-0000000000b1'::uuid, 'PO-2026-1001', '00000000-0000-0000-0000-0000000000a1'::uuid, 2500000.00, 'IT',          'open'),
  ('00000000-0000-0000-0000-0000000000b2'::uuid, 'PO-2026-1002', '00000000-0000-0000-0000-0000000000a2'::uuid,  900000.00, 'Procurement', 'partial'),
  ('00000000-0000-0000-0000-0000000000b3'::uuid, 'PO-2026-1003', '00000000-0000-0000-0000-0000000000a4'::uuid, 1750000.00, 'Facilities',  'open'),
  ('00000000-0000-0000-0000-0000000000b4'::uuid, 'PO-2026-1004', '00000000-0000-0000-0000-0000000000a6'::uuid,  420000.00, 'IT',          'closed'),
  ('00000000-0000-0000-0000-0000000000b5'::uuid, 'PO-2026-1005', '00000000-0000-0000-0000-0000000000a8'::uuid, 3100000.00, 'IT',          'open');

INSERT INTO invoices (id, invoice_number, vendor_id, po_id, invoice_date, due_date, amount, tax_amount, department, approval_status, payment_status, source, created_by) VALUES
  ('00000000-0000-0000-0000-0000000000c1'::uuid, 'TATA/26-27/1041', '00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid, '2026-06-10', '2026-07-25', 1875000.00, 337500.00, 'IT',          'approved', 'paid',    'csv',    'Kavya Iyer'),
  ('00000000-0000-0000-0000-0000000000c2'::uuid, 'TATA/26-27/1042', '00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid, '2026-07-28', '2026-09-11', 1875000.00, 337500.00, 'IT',          'pending',  'unpaid',  'csv',    'Kavya Iyer'),
  ('00000000-0000-0000-0000-0000000000c3'::uuid, 'REL/26-27/2210',  '00000000-0000-0000-0000-0000000000a2'::uuid, '00000000-0000-0000-0000-0000000000b2'::uuid, '2026-05-02', '2026-06-01', 468000.00,   84240.00, 'Procurement', 'approved', 'overdue', 'manual', 'Kavya Iyer'),
  ('00000000-0000-0000-0000-0000000000c4'::uuid, 'REL/26-27/2255',  '00000000-0000-0000-0000-0000000000a2'::uuid, NULL,                                         '2026-07-15', '2026-08-14', 322000.00,   57960.00, 'Marketing',   'pending',  'overdue', 'ocr',    'OCR pipeline'),
  ('00000000-0000-0000-0000-0000000000c5'::uuid, 'INFY/26-27/0777', '00000000-0000-0000-0000-0000000000a3'::uuid, NULL,                                         '2026-08-20', '2026-10-19', 1290000.00, 232200.00, 'IT',          'pending',  'unpaid',  'manual', 'Kavya Iyer'),
  ('00000000-0000-0000-0000-0000000000c6'::uuid, 'GODR/26-27/0912', '00000000-0000-0000-0000-0000000000a4'::uuid, '00000000-0000-0000-0000-0000000000b3'::uuid, '2026-06-25', '2026-08-09', 845000.00,  152100.00, 'Facilities',  'approved', 'overdue', 'csv',    'CSV import'),
  ('00000000-0000-0000-0000-0000000000c7'::uuid, 'ASIA/26-27/3300', '00000000-0000-0000-0000-0000000000a5'::uuid, NULL,                                         '2026-08-30', '2026-09-29', 268000.00,   48240.00, 'Facilities',  'pending',  'unpaid',  'csv',    'CSV import'),
  ('00000000-0000-0000-0000-0000000000c8'::uuid, 'HAVL/26-27/0455', '00000000-0000-0000-0000-0000000000a6'::uuid, '00000000-0000-0000-0000-0000000000b4'::uuid, '2026-07-01', '2026-07-31', 415000.00,   74700.00, 'IT',          'approved', 'paid',    'csv',    'CSV import'),
  ('00000000-0000-0000-0000-0000000000c9'::uuid, 'HAVL/26-27/0501', '00000000-0000-0000-0000-0000000000a6'::uuid, '00000000-0000-0000-0000-0000000000b4'::uuid, '2026-07-02', '2026-08-01', 415000.00,   74700.00, 'IT',          'pending',  'overdue', 'csv',    'CSV import'),
  ('00000000-0000-0000-0000-000000000c10'::uuid, 'BLUE/26-27/1050', '00000000-0000-0000-0000-0000000000a7'::uuid, NULL,                                         '2026-08-25', '2026-09-09', 38500.00,     6930.00, 'Logistics',   'approved', 'unpaid',  'ocr',    'OCR pipeline'),
  ('00000000-0000-0000-0000-000000000c11'::uuid, 'ZENS/26-27/4120', '00000000-0000-0000-0000-0000000000a8'::uuid, '00000000-0000-0000-0000-0000000000b5'::uuid, '2026-08-05', '2026-08-19', 2450000.00, 441000.00, 'IT',          'pending',  'unpaid',  'manual', 'Kavya Iyer'),
  ('00000000-0000-0000-0000-000000000c12'::uuid, 'ZENS/26-27/4155', '00000000-0000-0000-0000-0000000000a8'::uuid, '00000000-0000-0000-0000-0000000000b5'::uuid, '2026-08-06', '2026-09-20', 175000.00,   31500.00, 'IT',          'rejected', 'unpaid',  'manual', 'Kavya Iyer');

INSERT INTO payments (invoice_id, paid_at, amount_paid) VALUES
  ('00000000-0000-0000-0000-0000000000c1'::uuid, '2026-07-20T10:15:00Z', 2212500.00),
  ('00000000-0000-0000-0000-0000000000c8'::uuid, '2026-07-29T14:02:00Z',  489700.00);

INSERT INTO approvals (invoice_id, approver, level, status, acted_at) VALUES
  ('00000000-0000-0000-0000-0000000000c1'::uuid,  'priya.nair',  1, 'approved', '2026-06-12T09:30:00Z'),
  ('00000000-0000-0000-0000-0000000000c3'::uuid,  'rahul.menon', 1, 'approved', '2026-05-04T11:00:00Z'),
  ('00000000-0000-0000-0000-0000000000c6'::uuid,  'priya.nair',  1, 'approved', '2026-06-27T15:20:00Z'),
  ('00000000-0000-0000-0000-000000000c12'::uuid,  'anjali.rao',  1, 'rejected', '2026-08-08T12:45:00Z'),
  ('00000000-0000-0000-0000-0000000000c2'::uuid,  'priya.nair',  1, 'pending',  NULL);

INSERT INTO duplicate_flags (invoice_id, matched_invoice_id, confidence_score, method, reviewed_status) VALUES
  ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-0000000000c8'::uuid, 0.9600, 'rule_based', 'unreviewed'),
  ('00000000-0000-0000-0000-000000000c12'::uuid, '00000000-0000-0000-0000-000000000c11'::uuid, 0.7400, 'rule_based', 'false_positive');

INSERT INTO delay_predictions (invoice_id, delay_probability, predicted_delay_days, model_version) VALUES
  ('00000000-0000-0000-0000-0000000000c2'::uuid, 0.7200, 14, 'delay-risk-synthetic-v0'),
  ('00000000-0000-0000-0000-0000000000c5'::uuid, 0.4100,  6, 'delay-risk-synthetic-v0'),
  ('00000000-0000-0000-0000-000000000c11'::uuid, 0.8300, 21, 'delay-risk-synthetic-v0');
