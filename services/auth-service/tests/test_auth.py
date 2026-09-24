"""Runnable check: python tests/test_auth.py
Needs a live Postgres with the multi_tenant + keycloak_auth migrations applied
(PG_DATABASE_URL, default matches infra/.env.example) and
HASURA_GRAPHQL_JWT_SECRET set. Keycloak itself is stubbed out (see
_stub_keycloak below) — this test is about auth-service's own company/role
bookkeeping and token issuing, not Keycloak's credential storage."""

import os

os.environ.setdefault(
    "HASURA_GRAPHQL_JWT_SECRET",
    '{"type":"HS256","key":"dev-jwt-signing-key-change-me-32chars-min"}',
)
os.environ.setdefault("PG_DATABASE_URL", "postgres://postgres:postgrespassword@localhost:5433/invoice_tracker")
os.environ.setdefault("INTERNAL_SERVICE_TOKEN", "dev-internal-token-change-me")

from shared_types.jwt import HASURA_NAMESPACE, decode_hasura_jwt, mint_hasura_jwt  # noqa: E402
from app import keycloak_admin  # noqa: E402
from app.users import list_users, lookup_user  # noqa: E402
from app.main import me, refresh, register, create_invite_route, accept_invite_route  # noqa: E402
from app.main import RegisterRequest, InviteRequest, AcceptInviteRequest  # noqa: E402
from app.main import set_user_active_route, SetActiveRequest, users_lookup  # noqa: E402
from fastapi import HTTPException  # noqa: E402


def _stub_keycloak() -> None:
    """No live Keycloak in this check — every create_user call just
    succeeds, mirroring what a real one would do for a fresh username."""
    keycloak_admin.create_user = lambda username, email, password: f"stub-{username}"
    keycloak_admin.delete_user_by_username = lambda username: None


def run() -> None:
    _stub_keycloak()

    # seeded demo user, from the migration's seed data — company_id/role
    # bookkeeping only now; Keycloak owns whether "kavya"/"kavya" is correct.
    assert lookup_user("kavya").role == "finance_user"
    assert lookup_user("nobody") is None

    # /me and /refresh don't care how the original token was issued — mint
    # one directly the same way _mint() in app/main.py does.
    tok = mint_hasura_jwt(
        "approver", "priya.nair", ttl_seconds=3600,
        extra_claims={"app_role": "approver"},
        extra_hasura_claims={"x-hasura-company-id": "00000000-0000-0000-0000-000000000001"},
    )
    assert me(authorization=f"Bearer {tok}")[HASURA_NAMESPACE]["x-hasura-default-role"] == "approver"
    fresh = refresh(authorization=f"Bearer {tok}")
    assert fresh.role == "approver"

    # register: brand-new company + admin, fully isolated from Acme Traders
    pid = os.getpid()
    reg = register.__wrapped__(
        None,
        RegisterRequest(company_name=f"Contoso {pid}", username="admin", email=f"admin{pid}@contoso.test", password="hunter22"),
    )
    reg_decoded = decode_hasura_jwt(reg.access_token)
    reg_claims = reg_decoded[HASURA_NAMESPACE]
    # "admin" (app role) is minted as Hasura role "company_admin", never the
    # literal "admin" — that's a Hasura-reserved super-role that bypasses
    # every permission check, including company_id filtering.
    assert reg_decoded["app_role"] == "admin"
    assert reg_claims["x-hasura-default-role"] == "company_admin"
    assert reg.role == "admin"  # the API's own response still reports the app role
    new_company_id = reg_claims["x-hasura-company-id"]
    assert new_company_id != "00000000-0000-0000-0000-000000000001"
    assert any(u["username"] == "admin" for u in list_users(new_company_id))
    assert not any(u["username"] == "kavya" for u in list_users(new_company_id))

    # /users/lookup — what the BFF's Keycloak signIn callback calls
    looked_up = users_lookup("admin", None)
    assert looked_up == {"company_id": new_company_id, "role": "admin"}

    # invite + accept, scoped to the new company
    invite_resp = create_invite_route(
        InviteRequest(email=f"teammate{pid}@contoso.test", role="finance_user"),
        authorization=f"Bearer {reg.access_token}",
    )
    assert invite_resp.invite_link  # SMTP unset in dev -> link is always returned

    token = invite_resp.invite_link.split("token=")[1]
    accepted = accept_invite_route.__wrapped__(
        None, AcceptInviteRequest(token=token, username="teammate", password="hunter22"),
    )
    accepted_claims = decode_hasura_jwt(accepted.access_token)[HASURA_NAMESPACE]
    assert accepted_claims["x-hasura-default-role"] == "finance_user"
    assert accepted_claims["x-hasura-company-id"] == new_company_id

    # deactivate / reactivate
    set_user_active_route("teammate", SetActiveRequest(active=False), authorization=f"Bearer {reg.access_token}")
    assert lookup_user("teammate") is None  # lookup_user only returns active users
    set_user_active_route("teammate", SetActiveRequest(active=True), authorization=f"Bearer {reg.access_token}")
    assert lookup_user("teammate") is not None

    # can't deactivate yourself
    try:
        set_user_active_route("admin", SetActiveRequest(active=False), authorization=f"Bearer {reg.access_token}")
        raise AssertionError("expected 400")
    except HTTPException as e:
        assert e.status_code == 400

    print("auth-service: all checks passed")


if __name__ == "__main__":
    run()
