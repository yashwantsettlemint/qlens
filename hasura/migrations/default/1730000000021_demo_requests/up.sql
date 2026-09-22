-- Leads from the public landing page's "Book a demo" form. Not company-scoped
-- (the submitter isn't a signed-up customer yet) — admin-only via the BFF.
CREATE TABLE demo_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  contact_name text NOT NULL,
  work_email text NOT NULL,
  company_size text,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
