"""Hasura access for ocr-service, as the company-scoped `ocr_service` role
(self-minted JWT — see hasura/metadata's ocr_service permissions). Writes an
invalid draft into `review_queue`; reads `invoices`/`companies` to flag a
likely re-upload and match vendor aliases.
"""

from __future__ import annotations

import httpx

from shared_types.jwt import bearer, mint_hasura_jwt

from .config import HASURA_ENDPOINT, OCR_ROLE, OCR_USER_ID


class HasuraError(RuntimeError):
    pass


def _headers(company_id: str) -> dict[str, str]:
    token = mint_hasura_jwt(
        OCR_ROLE, OCR_USER_ID, ttl_seconds=300, extra_hasura_claims={"x-hasura-company-id": company_id}
    )
    return {**bearer(token), "x-hasura-role": OCR_ROLE}


async def _gql(query: str, variables: dict, company_id: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            HASURA_ENDPOINT,
            json={"query": query, "variables": variables},
            headers=_headers(company_id),
        )
    resp.raise_for_status()
    body = resp.json()
    if body.get("errors"):
        raise HasuraError(body["errors"][0].get("message", "GraphQL error"))
    return body["data"]


_INSERT = """
mutation AddReviewDraft($draft: jsonb!, $issues: [String!]!) {
  insert_review_queue_one(object: {invoice_draft: $draft, issues: $issues}) { id }
}
"""


async def insert_review_queue(draft: dict, issues: list[str], company_id: str) -> str:
    # company_id isn't sent — it's forced server-side by the ocr_service
    # role's insert `set` preset (a preset column can't also be a client-set
    # field on the generated insert_input type).
    data = await _gql(_INSERT, {"draft": draft, "issues": issues}, company_id)
    return data["insert_review_queue_one"]["id"]


_FIND_DUP = """
query FindDuplicate($num: String!, $companyId: uuid!) {
  invoices(where: {invoice_number: {_eq: $num}, company_id: {_eq: $companyId}}, order_by: {created_at: desc}, limit: 3) {
    id invoice_number invoice_date amount tax_amount
    vendor { name }
  }
}
"""


_COMPANY_SETTINGS = """
query CompanySettings($id: uuid!) {
  companies_by_pk(id: $id) { name aliases }
}
"""


async def fetch_company_settings(company_id: str) -> dict:
    """-> {name, aliases} for this tenant. `name` is "" until an admin sets it."""
    data = await _gql(_COMPANY_SETTINGS, {"id": company_id}, company_id)
    row = data.get("companies_by_pk") or {}
    return {"name": row.get("name") or "", "aliases": row.get("aliases") or []}


async def find_existing_by_number(invoice_number: str, company_id: str) -> list[dict]:
    """This company's invoices already committed with this exact number — the
    usual signal that the same document has been uploaded again. Was
    previously unscoped (admin secret, no filter), which both false-positived
    on another company's invoice number colliding and leaked that other
    company's vendor/amount/date back to the uploader."""
    num = (invoice_number or "").strip()
    if not num:
        return []
    rows = (await _gql(_FIND_DUP, {"num": num, "companyId": company_id}, company_id))["invoices"]
    return [
        {
            "id": r["id"],
            "invoice_number": r["invoice_number"],
            "invoice_date": r["invoice_date"],
            "amount": float(r["amount"]) if r.get("amount") is not None else None,
            "vendor_name": (r.get("vendor") or {}).get("name"),
        }
        for r in rows
    ]
