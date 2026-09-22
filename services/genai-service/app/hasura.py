"""Hasura access for genai-service.

`run_query` — role `genai_readonly` via a self-minted JWT (never the admin
secret). Everything reads through this. `run_admin` — the admin secret, used
ONLY by the /embed write path (read full invoice context + upsert the embedding
row). If Hasura rejects the readonly role somewhere it shouldn't, that's the
guardrail working.
"""

from __future__ import annotations

import httpx

from shared_types.jwt import bearer, mint_hasura_jwt

from .config import GENAI_ROLE, GENAI_USER_ID, HASURA_ADMIN_SECRET, HASURA_ENDPOINT


class HasuraError(RuntimeError):
    pass


def _headers(company_id: str) -> dict[str, str]:
    token = mint_hasura_jwt(
        GENAI_ROLE, GENAI_USER_ID, ttl_seconds=300, extra_hasura_claims={"x-hasura-company-id": company_id}
    )
    return {**bearer(token), "x-hasura-role": GENAI_ROLE}


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
    return await _post(query, variables, _headers(company_id))


async def run_admin(query: str, variables: dict) -> dict:
    """Admin-scoped, no company filtering — /embed's invoice read (id is
    already globally unique, and the row it returns carries its own
    company_id for the caller to use) and /embed/backfill's all-companies
    maintenance sweep."""
    if not HASURA_ADMIN_SECRET:
        raise HasuraError("HASURA_ADMIN_SECRET is not set — /embed is disabled")
    return await _post(query, variables, {"x-hasura-admin-secret": HASURA_ADMIN_SECRET})


# ---- RAG: semantic search (genai_readonly) + embed write (admin) --------------

_MATCH = """
query Match($v: String!, $k: Int!, $c: uuid!) {
  match_invoice_embeddings(args: {query_embedding: $v, match_count: $k, for_company_id: $c}) {
    invoice_id
    chunk_text
    similarity
    chunk_index
  }
}
"""


async def match_embeddings(vec_literal: str, company_id: str, k: int = 5) -> list[dict]:
    data = await run_query(_MATCH, {"v": vec_literal, "k": k, "c": company_id}, company_id)
    return data["match_invoice_embeddings"]


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
    a maintenance operation, not a per-tenant one, so it runs admin-scoped
    like fetch_invoice_full (each invoice's own company_id comes back with
    it, so the per-invoice embed write is still correctly scoped)."""
    data = await run_admin(_INVOICE_IDS, {})
    return [r["id"] for r in data["invoices"]]

_INVOICE_SUMMARY_CTX = """
query InvoiceSummary($id: uuid!) {
  invoices_by_pk(id: $id) {
    id invoice_number direction amount tax_amount department
    invoice_date due_date approval_status payment_status description
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
    data = await run_admin(_INVOICE_FULL, {"id": invoice_id})
    return data.get("invoices_by_pk")


_CLEAR_CHUNKS = """
mutation ClearChunks($id: uuid!) {
  delete_invoice_embeddings(where: {invoice_id: {_eq: $id}}) { affected_rows }
}
"""

_UPSERT = """
mutation UpsertEmbedding($id: uuid!, $i: Int!, $t: String!, $e: String!, $c: uuid!) {
  upsert_invoice_embedding(
    args: {p_invoice_id: $id, p_chunk_index: $i, p_chunk_text: $t, p_embedding: $e, p_company_id: $c}
  ) {
    invoice_id
  }
}
"""


async def replace_embeddings(invoice_id: str, chunks: list[tuple[str, str]], company_id: str) -> None:
    """Replaces every embedding row for this invoice with `chunks`
    (chunk_text, vec_literal pairs, in order) — always a clean delete + fresh
    insert rather than incremental upsert, so a re-embed that produces fewer
    chunks than last time doesn't leave stale rows behind."""
    await run_admin(_CLEAR_CHUNKS, {"id": invoice_id})
    for i, (chunk_text, vec_literal) in enumerate(chunks):
        await run_admin(_UPSERT, {"id": invoice_id, "i": i, "t": chunk_text, "e": vec_literal, "c": company_id})


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


async def fetch_duplicate_context(invoice_id: str, company_id: str) -> dict | None:
    data = await run_query(_EXPLAIN, {"id": invoice_id}, company_id)
    inv = data.get("invoices_by_pk")
    if not inv or not inv.get("duplicateFlag"):
        return None
    matched_id = inv["duplicateFlag"]["matched_invoice_id"]
    matched = (
        (await run_query(_MATCHED, {"id": matched_id}, company_id)).get("invoices_by_pk") if matched_id else None
    )
    return {"invoice": inv, "matched": matched}
