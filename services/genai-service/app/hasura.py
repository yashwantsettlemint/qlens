"""Hasura access for genai-service — always as role `genai_readonly`, via a
self-minted JWT (never the admin secret). If Hasura rejects the role, that's the
guardrail working.
"""

from __future__ import annotations

import httpx

from shared_types.jwt import bearer, mint_hasura_jwt

from .config import GENAI_ROLE, GENAI_USER_ID, HASURA_ENDPOINT


class HasuraError(RuntimeError):
    pass


def _headers() -> dict[str, str]:
    token = mint_hasura_jwt(GENAI_ROLE, GENAI_USER_ID, ttl_seconds=300)
    return {**bearer(token), "x-hasura-role": GENAI_ROLE}


async def run_query(query: str, variables: dict) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            HASURA_ENDPOINT,
            json={"query": query, "variables": variables},
            headers=_headers(),
        )
    resp.raise_for_status()
    body = resp.json()
    if body.get("errors"):
        raise HasuraError(body["errors"][0].get("message", "GraphQL error"))
    return body["data"]


_EXPLAIN = """
query DupContext($id: uuid!) {
  invoices_by_pk(id: $id) {
    id invoice_number amount tax_amount invoice_date department
    vendor { name }
    duplicateFlag { confidence_score method reviewed_status matched_invoice_id }
  }
}
"""

_MATCHED = """
query Matched($id: uuid!) {
  invoices_by_pk(id: $id) {
    invoice_number amount tax_amount invoice_date vendor { name }
  }
}
"""


async def fetch_duplicate_context(invoice_id: str) -> dict | None:
    data = await run_query(_EXPLAIN, {"id": invoice_id})
    inv = data.get("invoices_by_pk")
    if not inv or not inv.get("duplicateFlag"):
        return None
    matched_id = inv["duplicateFlag"]["matched_invoice_id"]
    matched = (await run_query(_MATCHED, {"id": matched_id})).get("invoices_by_pk") if matched_id else None
    return {"invoice": inv, "matched": matched}
