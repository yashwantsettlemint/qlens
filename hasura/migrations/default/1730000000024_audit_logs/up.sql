-- Security event log: failed/rejected auth and forbidden-role attempts.
-- company_id is nullable because some events (e.g. an invalid session token)
-- happen before any tenant is known. Admin-only — no Hasura role permissions,
-- written exclusively via the admin secret from server/audit.ts.
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_company_id_idx ON audit_logs (company_id);
CREATE INDEX audit_logs_event_type_idx ON audit_logs (event_type);
