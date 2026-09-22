"""Thin Hasura GraphQL client. Reads/writes as a self-minted `finance_user`
JWT (never the admin secret) — see hasura/metadata's finance_user permissions.
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
ROLE = "finance_user"


class HasuraError(RuntimeError):
    pass


def _headers(user_id: str, company_id: str) -> dict[str, str]:
    token = mint_hasura_jwt(
        ROLE, user_id, ttl_seconds=300, extra_hasura_claims={"x-hasura-company-id": company_id}
    )
    return {**bearer(token), "x-hasura-role": ROLE}


async def _gql(query: str, variables: dict, *, user_id: str, company_id: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            ENDPOINT, json={"query": query, "variables": variables}, headers=_headers(user_id, company_id)
        )
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
        user_id="ingestion-service",
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
    data = await _gql(_INSERT, {"objects": payload}, user_id=created_by, company_id=company_id)
    return data["insert_invoices"]
