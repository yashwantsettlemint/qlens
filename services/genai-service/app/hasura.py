"""Hasura access for genai-service — two self-minted JWT roles, never the
admin secret:

`run_query` — role `genai_readonly`, company-scoped. Everything reads through
this except the /embed write path.
`run_writer` — role `genai_writer`. Its `invoices` grant is deliberately
cross-tenant (see hasura/metadata) because /embed's invoice read and
/embed/backfill's id sweep both run before the invoice's own company_id is
known; its `invoice_embeddings` insert/delete grant IS company-scoped, via a
real company_id once the invoice read above has returned one.
"""

from __future__ import annotations

import httpx

from shared_types.jwt import bearer, mint_hasura_jwt

from .config import GENAI_ROLE, GENAI_USER_ID, GENAI_WRITER_ROLE, HASURA_ENDPOINT


class HasuraError(RuntimeError):
    pass


def _headers(role: str, company_id: str) -> dict[str, str]:
    token = mint_hasura_jwt(
        role, GENAI_USER_ID, ttl_seconds=300, extra_hasura_claims={"x-hasura-company-id": company_id}
    )
    return {**bearer(token), "x-hasura-role": role}


async def _post(query: str, variables: dict, headers: dict[str, str]) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            HASURA_ENDPOINT,
            json={"query": query, "variables": variables},
            headers=headers,
        )
    resp.raise_for_status()
    body = resp.json()
    if body.get("errors"):
        raise HasuraError(body["errors"][0].get("message", "GraphQL error"))
    return body["data"]


async def run_query(query: str, variables: dict, company_id: str) -> dict:
    return await _post(query, variables, _headers(GENAI_ROLE, company_id))


_NO_COMPANY = "00000000-0000-0000-0000-000000000000"  # must still be a well-formed uuid for the JWT claim


async def run_writer(query: str, variables: dict, company_id: str = _NO_COMPANY) -> dict:
    """`company_id` only matters for calls that touch `invoice_embeddings`
    (its permission filter is relationship-based, through `invoice`) — the
    cross-tenant `invoices` reads don't use the claim at all, so the zero
    uuid is fine for those."""
    return await _post(query, variables, _headers(GENAI_WRITER_ROLE, company_id))


# ---- RAG: semantic search + embed write now live in .db (genai_db, direct
# psycopg — see db.py's module docstring for why this moved off Hasura).

_INVOICE_FULL = """
query InvoiceForEmbedding($id: uuid!) {
  invoices_by_pk(id: $id) {
    id company_id invoice_number amount tax_amount department invoice_date due_date
    approval_status payment_status description extracted_text
    vendor { name }
    customer { name }
    lineItems { description quantity unit_price }
  }
}
"""

_INVOICE_IDS = """
query InvoiceIds {
  invoices {
    id
  }
}
"""


async def list_invoice_ids() -> list[str]:
    """All invoice ids across every company, for the /embed/backfill sweep —
    a maintenance operation, not a per-tenant one, so it runs genai_writer's
    cross-tenant `invoices` grant, id-only (each invoice's own company_id
    comes back from fetch_invoice_full, so the per-invoice embed write is
    still correctly scoped)."""
    data = await run_writer(_INVOICE_IDS, {})
    return [r["id"] for r in data["invoices"]]

_INVOICE_SUMMARY_CTX = """
query InvoiceSummary($id: uuid!) {
  invoices_by_pk(id: $id) {
    id invoice_number direction amount tax_amount department
    invoice_date due_date approval_status payment_status description extracted_text
    vendor { name }
    customer { name }
    lineItems { description quantity unit_price }
  }
}
"""


async def fetch_invoice_summary_context(invoice_id: str, company_id: str) -> dict | None:
    data = await run_query(_INVOICE_SUMMARY_CTX, {"id": invoice_id}, company_id)
    return data.get("invoices_by_pk")


async def fetch_invoice_full(invoice_id: str) -> dict | None:
    data = await run_writer(_INVOICE_FULL, {"id": invoice_id})
    return data.get("invoices_by_pk")


_EXPLAIN = """
query DupContext($id: uuid!) {
  invoices_by_pk(id: $id) {
    id invoice_number amount tax_amount invoice_date department
    vendor { name }
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


async def fetch_duplicate_context(invoice_id: str, company_id: str) -> dict | None:
    from . import ml_client  # local import: only /explain-duplicate needs this

    data = await run_query(_EXPLAIN, {"id": invoice_id}, company_id)
    inv = data.get("invoices_by_pk")
    if not inv:
        return None
    flag = await ml_client.get_duplicate_flag(invoice_id, company_id)
    if not flag:
        return None
    inv["duplicateFlag"] = flag
    matched_id = flag["matched_invoice_id"]
    matched = (
        (await run_query(_MATCHED, {"id": matched_id}, company_id)).get("invoices_by_pk") if matched_id else None
    )
    return {"invoice": inv, "matched": matched}
