"""Runnable check: python tests/test_auth.py
Needs a live Postgres with the multi_tenant migration applied (PG_DATABASE_URL,
default matches infra/.env.example) and HASURA_GRAPHQL_JWT_SECRET set."""

import os

os.environ.setdefault(
    "HASURA_GRAPHQL_JWT_SECRET",
    '{"type":"HS256","key":"dev-jwt-signing-key-change-me-32chars-min"}',
)
os.environ.setdefault("PG_DATABASE_URL", "postgres://postgres:postgrespassword@localhost:5433/invoice_tracker")

from shared_types.jwt import HASURA_NAMESPACE, decode_hasura_jwt  # noqa: E402
from app.users import authenticate, list_users  # noqa: E402
from app.main import login, register, me, refresh, create_invite_route, accept_invite_route  # noqa: E402
from app.main import LoginRequest, RegisterRequest, InviteRequest, AcceptInviteRequest  # noqa: E402
from app.main import set_user_active_route, SetActiveRequest  # noqa: E402
from fastapi import HTTPException  # noqa: E402


def run() -> None:
    # seeded demo user, from the migration's seed data
    assert authenticate("kavya", "kavya").role == "finance_user"
    assert authenticate("kavya", "wrong") is None
    assert authenticate("nobody", "x") is None

    tok = login(LoginRequest(username="priya.nair", password="priya"))
    assert tok.role == "approver" and tok.token_type == "Bearer"
    claims = decode_hasura_jwt(tok.access_token)
    h = claims[HASURA_NAMESPACE]
    assert h["x-hasura-default-role"] == "approver"
    assert h["x-hasura-user-id"] == "priya.nair"
    assert h["x-hasura-company-id"] == "00000000-0000-0000-0000-000000000001"
    assert claims["exp"] > claims["iat"]

    assert me(authorization=f"Bearer {tok.access_token}")[HASURA_NAMESPACE]["x-hasura-default-role"] == "approver"

    fresh = refresh(authorization=f"Bearer {tok.access_token}")
    assert fresh.role == "approver"

    try:
        login(LoginRequest(username="priya.nair", password="nope"))
        raise AssertionError("expected 401")
    except HTTPException as e:
        assert e.status_code == 401

    # register: brand-new company + admin, fully isolated from Acme Traders
    pid = os.getpid()
    reg = register(RegisterRequest(company_name=f"Contoso {pid}", username="admin", email=f"admin{pid}@contoso.test", password="hunter22"))
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

    # invite + accept, scoped to the new company
    invite_resp = create_invite_route(
        InviteRequest(email=f"teammate{pid}@contoso.test", role="finance_user"),
        authorization=f"Bearer {reg.access_token}",
    )
    assert invite_resp.invite_link  # SMTP unset in dev -> link is always returned

    token = invite_resp.invite_link.split("token=")[1]
    accepted = accept_invite_route(AcceptInviteRequest(token=token, username="teammate", password="hunter22"))
    accepted_claims = decode_hasura_jwt(accepted.access_token)[HASURA_NAMESPACE]
    assert accepted_claims["x-hasura-default-role"] == "finance_user"
    assert accepted_claims["x-hasura-company-id"] == new_company_id

    # deactivate / reactivate — a deactivated user can no longer log in
    set_user_active_route("teammate", SetActiveRequest(active=False), authorization=f"Bearer {reg.access_token}")
    assert authenticate("teammate", "hunter22") is None
    set_user_active_route("teammate", SetActiveRequest(active=True), authorization=f"Bearer {reg.access_token}")
    assert authenticate("teammate", "hunter22") is not None

    # can't deactivate yourself
    try:
        set_user_active_route("admin", SetActiveRequest(active=False), authorization=f"Bearer {reg.access_token}")
        raise AssertionError("expected 400")
    except HTTPException as e:
        assert e.status_code == 400

    print("auth-service: all checks passed")


if __name__ == "__main__":
    run()
