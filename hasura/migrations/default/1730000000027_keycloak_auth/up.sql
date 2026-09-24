-- Credentials and brute-force lockout are now owned by Keycloak
-- (services/auth-service no longer stores or checks passwords locally —
-- see services/auth-service/app/users.py and app/keycloak_admin.py). The
-- `users` table keeps company_id/role bookkeeping only.
ALTER TABLE users
  DROP COLUMN password_hash,
  DROP COLUMN failed_login_count,
  DROP COLUMN locked_until;
