"""Mint / verify Hasura-shaped JWTs.

One implementation shared by auth-service (issues tokens for humans) and by the
services that need a role-scoped token for their own Hasura calls (genai, ml).
Reads the same `HASURA_GRAPHQL_JWT_SECRET` value Hasura itself uses, e.g.
`{"type":"HS256","key":"..."}`.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

import jwt as _jwt

HASURA_NAMESPACE = "https://hasura.io/jwt/claims"


def parse_jwt_secret(raw: str | None = None) -> tuple[str, str]:
    """(algorithm, key) from the HASURA_GRAPHQL_JWT_SECRET JSON blob (or a bare key)."""
    raw = raw or os.getenv("HASURA_GRAPHQL_JWT_SECRET") or ""
    raw = raw.strip()
    if raw.startswith("{"):
        cfg = json.loads(raw)
        return cfg.get("type", "HS256"), cfg["key"]
    if not raw:
        raise RuntimeError("HASURA_GRAPHQL_JWT_SECRET is not set")
    return "HS256", raw


def mint_hasura_jwt(
    role: str,
    user_id: str,
    *,
    allowed_roles: list[str] | None = None,
    ttl_seconds: int = 3600,
    secret_raw: str | None = None,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    alg, key = parse_jwt_secret(secret_raw)
    now = int(time.time())
    # backdate iat to absorb host/container clock skew (Hasura rejects a future iat)
    claims: dict[str, Any] = {
        "sub": user_id,
        "iat": now - 60,
        "exp": now + ttl_seconds,
        HASURA_NAMESPACE: {
            "x-hasura-default-role": role,
            "x-hasura-allowed-roles": allowed_roles or [role],
            "x-hasura-user-id": user_id,
        },
    }
    if extra_claims:
        claims.update(extra_claims)
    return _jwt.encode(claims, key, algorithm=alg)


def decode_hasura_jwt(token: str, *, secret_raw: str | None = None) -> dict[str, Any]:
    alg, key = parse_jwt_secret(secret_raw)
    return _jwt.decode(token, key, algorithms=[alg])


def bearer(token: str) -> dict[str, str]:
    """Authorization header for an httpx call to Hasura with a minted token."""
    return {"Authorization": f"Bearer {token}"}
