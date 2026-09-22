"""Hasura access for ocr-service — admin secret. Writes an invalid draft into
`review_queue`; reads `invoices` to flag a likely re-upload of the same invoice
(a trusted in-cluster service, per the ml-service / notification-service pattern).
"""

from __future__ import annotations

import httpx

from .config import HASURA_ADMIN_SECRET, HASURA_ENDPOINT


class HasuraError(RuntimeError):
    pass


async def _gql(query: str, variables: dict) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            HASURA_ENDPOINT,
            json={"query": query, "variables": variables},
            headers={"x-hasura-admin-secret": HASURA_ADMIN_SECRET},
        )
    resp.raise_for_status()
    body = resp.json()
    if body.get("errors"):
        raise HasuraError(body["errors"][0].get("message", "GraphQL error"))
    return body["data"]


_INSERT = """
mutation AddReviewDraft($draft: jsonb!, $issues: [String!]!, $companyId: uuid!) {
  insert_review_queue_one(object: {invoice_draft: $draft, issues: $issues, company_id: $companyId}) { id }
}
"""


async def insert_review_queue(draft: dict, issues: list[str], company_id: str) -> str:
    data = await _gql(_INSERT, {"draft": draft, "issues": issues, "companyId": company_id})
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
    data = await _gql(_COMPANY_SETTINGS, {"id": company_id})
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
    rows = (await _gql(_FIND_DUP, {"num": num, "companyId": company_id}))["invoices"]
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
