"""Runnable check:  python tests/test_auth.py  (needs HASURA_GRAPHQL_JWT_SECRET set,
or it uses the compose dev default)."""

import os

os.environ.setdefault(
    "HASURA_GRAPHQL_JWT_SECRET",
    '{"type":"HS256","key":"dev-jwt-signing-key-change-me-32chars-min"}',
)

from shared_types.jwt import HASURA_NAMESPACE, decode_hasura_jwt  # noqa: E402
from app.users import authenticate  # noqa: E402
from app.main import login, me, refresh, LoginRequest  # noqa: E402
from fastapi import HTTPException  # noqa: E402


def run() -> None:
    assert authenticate("kavya", "kavya").role == "finance_user"
    assert authenticate("kavya", "wrong") is None
    assert authenticate("nobody", "x") is None

    tok = login(LoginRequest(username="priya.nair", password="priya"))
    assert tok.role == "approver" and tok.token_type == "Bearer"

    claims = decode_hasura_jwt(tok.access_token)
    h = claims[HASURA_NAMESPACE]
    assert h["x-hasura-default-role"] == "approver"
    assert h["x-hasura-user-id"] == "priya.nair"
    assert claims["exp"] > claims["iat"]

    assert me(authorization=f"Bearer {tok.access_token}")[HASURA_NAMESPACE]["x-hasura-default-role"] == "approver"

    # /refresh re-issues a valid token with the same role/user
    fresh = refresh(authorization=f"Bearer {tok.access_token}")
    assert fresh.role == "approver"
    fc = decode_hasura_jwt(fresh.access_token)[HASURA_NAMESPACE]
    assert fc["x-hasura-user-id"] == "priya.nair"
    try:
        refresh(authorization="")
        raise AssertionError("expected 401 for missing token")
    except HTTPException as e:
        assert e.status_code == 401

    try:
        login(LoginRequest(username="priya.nair", password="nope"))
        raise AssertionError("expected 401")
    except HTTPException as e:
        assert e.status_code == 401

    print("auth-service: all checks passed")


if __name__ == "__main__":
    run()
