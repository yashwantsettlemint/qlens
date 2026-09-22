"""Hasura access for the overdue sweep. Runs as `notifier` — a self-minted,
deliberately cross-tenant role (the sweep runs across every company), narrowed
to just the invoices/vendor columns it reads/writes (see hasura/metadata's
notifier permissions), not the admin secret.
"""

from __future__ import annotations

import os

import httpx

from shared_types.jwt import bearer, mint_hasura_jwt

ENDPOINT = (
    os.getenv("HASURA_ENDPOINT")
    or os.getenv("HASURA_GRAPHQL_ENDPOINT")
    or "http://localhost:8088/v1/graphql"
)
NOTIFIER_ROLE = "notifier"
NOTIFIER_USER_ID = "notification-service"


class HasuraError(RuntimeError):
    pass


def _headers() -> dict[str, str]:
    # No x-hasura-company-id claim needed — the notifier role's permissions
    # don't reference it (see hasura/metadata/.../public_invoices.yaml).
    token = mint_hasura_jwt(NOTIFIER_ROLE, NOTIFIER_USER_ID, ttl_seconds=300)
    return {**bearer(token), "x-hasura-role": NOTIFIER_ROLE}


async def _gql(query: str, variables: dict) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            ENDPOINT,
            json={"query": query, "variables": variables},
            headers=_headers(),
        )
    resp.raise_for_status()
    body = resp.json()
    if body.get("errors"):
        raise HasuraError(body["errors"][0].get("message", "GraphQL error"))
    return body["data"]


_FIND = """
query PastDue($today: date!) {
  invoices(where: {payment_status: {_eq: "unpaid"}, due_date: {_lt: $today}}) {
    id invoice_number due_date amount department direction
    vendor { name email }
  }
}
"""

_MARK = """
mutation MarkOverdue($ids: [uuid!]!) {
  update_invoices(where: {id: {_in: $ids}}, _set: {payment_status: "overdue"}) {
    affected_rows
  }
}
"""


async def find_past_due(today: str) -> list[dict]:
    return (await _gql(_FIND, {"today": today}))["invoices"]


async def mark_overdue(ids: list[str]) -> int:
    if not ids:
        return 0
    return (await _gql(_MARK, {"ids": ids}))["update_invoices"]["affected_rows"]
