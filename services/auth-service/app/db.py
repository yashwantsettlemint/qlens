"""Postgres connection for the users/companies/invites tables.

Uses its own restricted role (AUTH_PG_DATABASE_URL, see migration
1730000000014_auth_restricted_role) — granted SELECT/INSERT/UPDATE on
exactly users/companies/invites, nothing else, so a leaked credential here
can never read an invoice/vendor/payment row. Falls back to PG_DATABASE_URL
(the shared superuser) if the restricted var isn't set, for any deployment
that hasn't picked up the migration yet.

ponytail: one connection per call, not a pool — auth traffic is low-volume
for this service. Swap for psycopg_pool if that ever stops being true.
"""

from __future__ import annotations

import os

import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.getenv("AUTH_PG_DATABASE_URL") or os.getenv("PG_DATABASE_URL", "")


def get_conn() -> psycopg.Connection:
    if not DATABASE_URL:
        raise RuntimeError("AUTH_PG_DATABASE_URL (or PG_DATABASE_URL) is not set")
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=True)
