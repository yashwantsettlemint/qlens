"""Hasura access for the overdue sweep. Runs as admin (bulk status update)."""

from __future__ import annotations

import os

import httpx

ENDPOINT = (
    os.getenv("HASURA_ENDPOINT")
    or os.getenv("HASURA_GRAPHQL_ENDPOINT")
    or "http://localhost:8088/v1/graphql"
)
ADMIN_SECRET = (
    os.getenv("HASURA_ADMIN_SECRET")
    or os.getenv("HASURA_GRAPHQL_ADMIN_SECRET")
    or "devsecret"
)


class HasuraError(RuntimeError):
    pass


async def _gql(query: str, variables: dict) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            ENDPOINT,
            json={"query": query, "variables": variables},
            headers={"x-hasura-admin-secret": ADMIN_SECRET},
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
