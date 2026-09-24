-- create_user() (app/users.py) now provisions a matching Keycloak account
-- after inserting the Postgres row, and rolls that row back if the Keycloak
-- side fails (see app/keycloak_admin.py) — so the two stores never drift.
-- The restricted auth_service role never needed DELETE before this.
GRANT DELETE ON users TO auth_service;
