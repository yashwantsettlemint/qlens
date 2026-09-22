-- auth-service is the only service with its own direct Postgres connection
-- (everything else goes through Hasura). Today it uses the same superuser
-- string (PG_DATABASE_URL) as Hasura and the migration runner — a leaked
-- copy of that string would expose every company's invoices/vendors/
-- payments, not just the account data auth-service actually needs.
--
-- Give it its own login role, grant only what services/auth-service/app/users.py
-- actually does (authenticate reads users; create_user/register_company
-- insert into users/companies; accept_invite updates invites and inserts
-- into users) — nothing on any other table. The *absence* of a grant is the
-- enforcement: Postgres denies by default, no RLS needed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_service') THEN
    CREATE ROLE auth_service LOGIN PASSWORD 'postgrespassword';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE invoice_tracker TO auth_service;
GRANT USAGE ON SCHEMA public TO auth_service;
GRANT SELECT, INSERT, UPDATE ON users, companies, invites TO auth_service;
