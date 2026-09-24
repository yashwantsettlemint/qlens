"""Companies, users and invites — backed by Postgres (the `companies`,
`users`, `invites` tables from hasura/migrations/default/1730000000011_multi_tenant).

Credentials and brute-force lockout are owned by Keycloak (app/keycloak_admin.py)
— this module only tracks company_id/role bookkeeping and provisions the
matching Keycloak account whenever it creates a user, so the two stores never
drift apart. No password is ever stored here.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from psycopg.errors import UniqueViolation

from . import keycloak_admin
from .db import get_conn

_ALLOWED_ROLES = {"finance_user", "approver", "admin"}
INVITE_TTL_DAYS = 7
MIN_PASSWORD_LENGTH = 8


@dataclass(frozen=True)
class User:
    id: str
    company_id: str
    username: str
    email: str
    role: str


@dataclass(frozen=True)
class Company:
    id: str
    name: str


@dataclass(frozen=True)
class Invite:
    id: str
    company_id: str
    email: str
    role: str
    token: str
    company_name: str


def _row_to_user(row: dict) -> User:
    return User(str(row["id"]), str(row["company_id"]), row["username"], row["email"], row["role"])


def lookup_user(username: str) -> User | None:
    """By username only — used to attach company_id/role to a session after
    Keycloak has already verified the person's identity (see apps/web/auth.ts's
    signIn callback, which calls GET /users/lookup)."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = %s AND is_active LIMIT 1",
            (username,),
        ).fetchone()
    return _row_to_user(row) if row else None


def list_users(company_id: str) -> list[dict[str, str | bool]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT username, email, role, is_active FROM users WHERE company_id = %s ORDER BY created_at",
            (company_id,),
        ).fetchall()
    return [
        {"username": r["username"], "email": r["email"], "role": r["role"], "active": r["is_active"]}
        for r in rows
    ]


def set_user_active(company_id: str, username: str, active: bool) -> dict[str, str | bool]:
    with get_conn() as conn:
        row = conn.execute(
            "UPDATE users SET is_active = %s WHERE company_id = %s AND username = %s RETURNING username, email, role, is_active",
            (active, company_id, username),
        ).fetchone()
    if row is None:
        raise ValueError(f"user '{username}' not found")
    return {"username": row["username"], "email": row["email"], "role": row["role"], "active": row["is_active"]}


def create_user(company_id: str, username: str, password: str, role: str, email: str) -> User:
    normalized_username = (username or "").strip()
    normalized_email = (email or "").strip().lower()
    if not normalized_username:
        raise ValueError("username is required")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    if role not in _ALLOWED_ROLES:
        raise ValueError(f"unsupported role: {role}")
    if not normalized_email or "@" not in normalized_email:
        raise ValueError("email is not valid")

    with get_conn() as conn:
        exists = conn.execute(
            "SELECT 1 FROM users WHERE company_id = %s AND username = %s",
            (company_id, normalized_username),
        ).fetchone()
        if exists:
            raise ValueError(f"user '{normalized_username}' already exists")
        try:
            row = conn.execute(
                """INSERT INTO users (company_id, username, email, role)
                   VALUES (%s, %s, %s, %s) RETURNING *""",
                (company_id, normalized_username, normalized_email, role),
            ).fetchone()
        except UniqueViolation:
            raise ValueError(f"email '{normalized_email}' already has an account") from None

        try:
            keycloak_admin.create_user(normalized_username, normalized_email, password)
        except keycloak_admin.KeycloakError:
            # Keep the two stores in sync — a user that only exists in
            # Postgres could never actually sign in.
            conn.execute("DELETE FROM users WHERE id = %s", (row["id"],))
            raise
    return _row_to_user(row)


def register_company(company_name: str, username: str, password: str, email: str) -> tuple[Company, User]:
    """Sign-up: a brand-new company plus its first (admin) user."""
    normalized_company = (company_name or "").strip()
    if not normalized_company:
        raise ValueError("company name is required")
    with get_conn() as conn:
        company_row = conn.execute(
            "INSERT INTO companies (name) VALUES (%s) RETURNING *",
            (normalized_company,),
        ).fetchone()
    company = Company(str(company_row["id"]), company_row["name"])
    user = create_user(company.id, username, password, "admin", email)
    return company, user


def create_invite(company_id: str, invited_by: str, email: str, role: str) -> Invite:
    normalized_email = (email or "").strip().lower()
    if not normalized_email or "@" not in normalized_email:
        raise ValueError("email is not valid")
    if role not in _ALLOWED_ROLES:
        raise ValueError(f"unsupported role: {role}")

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS)
    with get_conn() as conn:
        row = conn.execute(
            """INSERT INTO invites (company_id, email, role, token, invited_by, expires_at)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
            (company_id, normalized_email, role, token, invited_by, expires_at),
        ).fetchone()
        company = conn.execute("SELECT name FROM companies WHERE id = %s", (company_id,)).fetchone()
    return Invite(
        str(row["id"]), str(row["company_id"]), row["email"], row["role"], row["token"], company["name"]
    )


def accept_invite(token: str, username: str, password: str) -> User:
    with get_conn() as conn:
        invite = conn.execute(
            "SELECT * FROM invites WHERE token = %s",
            (token,),
        ).fetchone()
        if invite is None:
            raise ValueError("invite not found")
        if invite["accepted_at"] is not None:
            raise ValueError("invite already used")
        expires_at = invite["expires_at"]
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise ValueError("invite has expired")

        user = create_user(str(invite["company_id"]), username, password, invite["role"], invite["email"])
        conn.execute("UPDATE invites SET accepted_at = now() WHERE id = %s", (invite["id"],))
    return user
