"""Hasura access for ml-service. Reads context (vendor's other invoices, vendor
payment history) as `ml_service` — a company-scoped role, self-minted per call
(see hasura/metadata's ml_service permissions), not the admin secret.
duplicate_flags/delay_predictions/ml_drift_reports/ml_retrain_events all now
live in this service's own private database — see db.py.
"""

from __future__ import annotations

import httpx

from shared_types.jwt import bearer, mint_hasura_jwt

from .config import HASURA_ENDPOINT, ML_ROLE, ML_USER_ID


class HasuraError(RuntimeError):
    pass


def _headers(company_id: str) -> dict[str, str]:
    token = mint_hasura_jwt(
        ML_ROLE, ML_USER_ID, ttl_seconds=300, extra_hasura_claims={"x-hasura-company-id": company_id}
    )
    return {**bearer(token), "x-hasura-role": ML_ROLE}


async def _gql(query: str, variables: dict, company_id: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
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


# Context + history are scoped to one party. A payable's party is its vendor;
# a receivable's party is its customer. The queries branch on `$col`, injected
# as the raw column name — never user input, only "vendor_id" | "customer_id".
_CONTEXT = """
query Ctx($partyId: uuid!, $selfId: uuid) {
  siblings: invoices(where: {%(col)s: {_eq: $partyId}, id: {_neq: $selfId}}) {
    id invoice_number amount tax_amount po_id invoice_date department
  }
  paid: invoices(where: {%(col)s: {_eq: $partyId}, payment_status: {_eq: "paid"}}) {
    due_date
    payments(order_by: {paid_at: asc}, limit: 1) { paid_at }
  }
}
"""

_ZERO_UUID = "00000000-0000-0000-0000-000000000000"


def _party_col(direction: str) -> str:
    return "customer_id" if direction == "receivable" else "vendor_id"


async def fetch_context(
    party_id: str, self_id: str | None, company_id: str, direction: str = "payable"
) -> tuple[list[dict], list[dict]]:
    query = _CONTEXT % {"col": _party_col(direction)}
    data = await _gql(query, {"partyId": party_id, "selfId": self_id or _ZERO_UUID}, company_id)
    paid_history = [
        {"due_date": r["due_date"], "paid_at": (r["payments"][0]["paid_at"] if r["payments"] else None)}
        for r in data["paid"]
    ]
    return data["siblings"], paid_history


_PARTY_OPEN = """
query PartyOpen($partyId: uuid!) {
  invoices(where: {%(col)s: {_eq: $partyId}, payment_status: {_neq: "paid"}}) {
    id amount tax_amount department invoice_date po_id
  }
}
"""


async def fetch_open_invoices(party_id: str, company_id: str, direction: str = "payable") -> list[dict]:
    """This party's still-unpaid invoices — re-scored when their on-time rate
    shifts (i.e. one of their invoices is marked paid)."""
    query = _PARTY_OPEN % {"col": _party_col(direction)}
    return (await _gql(query, {"partyId": party_id}, company_id))["invoices"]


# duplicate_flags / delay_predictions writes now live in .db (ml_db, direct
# psycopg — see db.py's module docstring for why this moved off Hasura).

# --- drift / retrain support -------------------------------------------------

_RECENT_INVOICES = """
query Recent($limit: Int!, $companyId: uuid!) {
  invoices(order_by: {created_at: desc}, limit: $limit, where: {company_id: {_eq: $companyId}}) {
    id direction vendor_id customer_id amount tax_amount department
    invoice_date po_id approvals_aggregate { aggregate { count } }
  }
}
"""


async def fetch_recent_invoices(company_id: str, limit: int = 500) -> list[dict]:
    """This company's most recently created invoices, for feature-drift
    sampling — not restricted to paid ones (unlike the training/performance-
    drift query), since feature drift is about what's being *scored*, not
    just settled."""
    data = await _gql(_RECENT_INVOICES, {"limit": limit, "companyId": company_id}, company_id)
    return data["invoices"]


# ml_drift_reports / ml_retrain_events now live in .db (ml_db, direct psycopg
# — see db.py's module docstring for why this moved off Hasura).
