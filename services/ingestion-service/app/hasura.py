"""Thin Hasura GraphQL client. Reads/writes as a trusted backend service.

ponytail: authenticates with the admin secret + an `x-hasura-role` override
(fine for a trusted in-cluster service). Swap for a minted finance_user JWT if
this service is ever exposed outside the cluster.
"""

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


async def _gql(
    query: str,
    variables: dict,
    *,
    role: str | None = None,
    user_id: str | None = None,
    company_id: str | None = None,
) -> dict:
    headers = {"x-hasura-admin-secret": ADMIN_SECRET}
    if role:
        headers["x-hasura-role"] = role
    if user_id:
        headers["x-hasura-user-id"] = user_id
    if company_id:
        headers["x-hasura-company-id"] = company_id
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(ENDPOINT, json={"query": query, "variables": variables}, headers=headers)
    resp.raise_for_status()
    body = resp.json()
    if body.get("errors"):
        raise HasuraError(body["errors"][0].get("message", "GraphQL error"))
    return body["data"]


async def fetch_lookups(company_id: str) -> tuple[dict[str, str], dict[str, str]]:
    """(vendor_id_by_lowercase_name, po_id_by_lowercase_number), scoped to one
    company — without role+company_id this ran as full admin and matched CSV
    rows against every company's vendors/POs, not just the uploader's own."""
    data = await _gql(
        "{ vendors { id name } purchase_orders { id po_number } }",
        {},
        role="finance_user",
        company_id=company_id,
    )
    vendors = {r["name"].lower(): r["id"] for r in data["vendors"]}
    pos = {r["po_number"].lower(): r["id"] for r in data["purchase_orders"]}
    return vendors, pos


_INSERT = """
mutation Ingest($objects: [invoices_insert_input!]!) {
  insert_invoices(objects: $objects) {
    affected_rows
    returning { id invoice_number }
  }
}
"""


async def insert_invoices(objects: list[dict], created_by: str, company_id: str) -> dict:
    """One batched insert as finance_user — each row fires the invoice_ml_score
    event trigger. company_id is auto-set by Hasura's insert permission preset
    (see hasura/metadata's invoices.yaml) from the x-hasura-company-id header."""
    payload = [{**obj, "created_by": created_by} for obj in objects]
    data = await _gql(_INSERT, {"objects": payload}, role="finance_user", user_id=created_by, company_id=company_id)
    return data["insert_invoices"]
