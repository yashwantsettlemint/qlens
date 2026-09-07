"""Mock user directory. NOT FOR PRODUCTION — no real IdP, no password policy,
no lockout. Replace with your identity provider; only /login and the JWT shape
need to stay the same.

Users come from AUTH_USERS (JSON) if set, else a built-in dev set:

    AUTH_USERS='[{"username":"kavya","password":"kavya","role":"finance_user"},
                 {"username":"priya","password":"priya","role":"approver"}]'
"""

from __future__ import annotations

import hmac
import json
import os
from dataclasses import dataclass

from shared_types import HasuraRole

_DEFAULT = [
    {"username": "kavya", "password": "kavya", "role": HasuraRole.FINANCE_USER.value},
    {"username": "priya.nair", "password": "priya", "role": HasuraRole.APPROVER.value},
    {"username": "rahul.menon", "password": "rahul", "role": HasuraRole.APPROVER.value},
    {"username": "anjali.rao", "password": "anjali", "role": HasuraRole.ADMIN.value},
    {"username": "genai-bot", "password": "genai", "role": HasuraRole.GENAI_READONLY.value},
]


@dataclass(frozen=True)
class User:
    username: str
    password: str
    role: str


def _load() -> dict[str, User]:
    raw = os.getenv("AUTH_USERS")
    rows = json.loads(raw) if raw else _DEFAULT
    return {r["username"]: User(r["username"], r["password"], r["role"]) for r in rows}


_USERS = _load()


def authenticate(username: str, password: str) -> User | None:
    user = _USERS.get(username)
    if user is None:
        return None
    # constant-time compare — the one security nicety that costs nothing
    if not hmac.compare_digest(user.password, password):
        return None
    return user
