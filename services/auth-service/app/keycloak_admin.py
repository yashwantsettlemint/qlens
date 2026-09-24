"""Thin client for the one thing auth-service still needs Keycloak's Admin
REST API for: provisioning the credential-owning account behind a user this
service creates (register / create_user / accept_invite). Keycloak owns
passwords and brute-force lockout; this service keeps owning company_id/role
bookkeeping (see app/users.py) — the two are kept in sync by always creating
both together.
"""

from __future__ import annotations

import os
import time

import httpx

KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://localhost:8097").rstrip("/")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "invoice-tracker")
ADMIN_CLIENT_ID = os.getenv("KEYCLOAK_ADMIN_CLIENT_ID", "auth-service-admin")
ADMIN_CLIENT_SECRET = os.getenv("KEYCLOAK_ADMIN_CLIENT_SECRET", "")

_TOKEN_ENDPOINT = f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token"
_USERS_ENDPOINT = f"{KEYCLOAK_URL}/admin/realms/{KEYCLOAK_REALM}/users"

_cached_token: str | None = None
_cached_token_exp = 0.0


class KeycloakError(Exception):
    """Keycloak rejected the request — the caller should not partially commit
    (e.g. auth-service rolls back its own Postgres insert on this)."""


def _admin_token() -> str:
    global _cached_token, _cached_token_exp
    if _cached_token and time.monotonic() < _cached_token_exp:
        return _cached_token
    resp = httpx.post(
        _TOKEN_ENDPOINT,
        data={
            "grant_type": "client_credentials",
            "client_id": ADMIN_CLIENT_ID,
            "client_secret": ADMIN_CLIENT_SECRET,
        },
        timeout=10,
    )
    if resp.status_code != 200:
        raise KeycloakError(f"could not get an admin token: {resp.status_code} {resp.text}")
    body = resp.json()
    _cached_token = body["access_token"]
    # Refresh a bit early rather than racing the exact expiry.
    _cached_token_exp = time.monotonic() + max(body.get("expires_in", 60) - 30, 5)
    return _cached_token


def create_user(username: str, email: str, password: str) -> str:
    """Creates the Keycloak-side account backing a locally-provisioned user.
    Returns the new Keycloak user id. Raises KeycloakError on failure — the
    caller (app/users.py) rolls back its own Postgres insert when this fails,
    so the two stores never drift out of sync."""
    resp = httpx.post(
        _USERS_ENDPOINT,
        headers={"authorization": f"Bearer {_admin_token()}"},
        json={
            "username": username,
            "email": email,
            "enabled": True,
            "emailVerified": True,
            "credentials": [{"type": "password", "value": password, "temporary": False}],
        },
        timeout=10,
    )
    if resp.status_code != 201:
        raise KeycloakError(f"could not create Keycloak user '{username}': {resp.status_code} {resp.text}")
    location = resp.headers.get("location", "")
    return location.rsplit("/", 1)[-1]


def delete_user_by_username(username: str) -> None:
    """Best-effort cleanup if a Postgres-side step fails after the Keycloak
    account was already created — never raises, this runs inside an
    exception handler."""
    try:
        resp = httpx.get(
            _USERS_ENDPOINT,
            headers={"authorization": f"Bearer {_admin_token()}"},
            params={"username": username, "exact": "true"},
            timeout=10,
        )
        for u in resp.json():
            httpx.delete(f"{_USERS_ENDPOINT}/{u['id']}", headers={"authorization": f"Bearer {_admin_token()}"}, timeout=10)
    except Exception:
        pass
