REVOKE SELECT, INSERT, UPDATE ON users, companies, invites FROM auth_service;
REVOKE USAGE ON SCHEMA public FROM auth_service;
REVOKE CONNECT ON DATABASE invoice_tracker FROM auth_service;
DROP ROLE IF EXISTS auth_service;
