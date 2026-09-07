"""Hasura access for ml-service. Reads context (vendor's other invoices, vendor
payment history) and writes results back to duplicate_flags / delay_predictions
as admin (per the brief — an admin-scoped service token).
"""

from __future__ import annotations

import httpx

from .config import HASURA_ADMIN_SECRET, HASURA_ENDPOINT


class HasuraError(RuntimeError):
    pass


async def _gql(query: str, variables: dict) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
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


_CONTEXT = """
query Ctx($vendorId: uuid!, $selfId: uuid) {
  siblings: invoices(where: {vendor_id: {_eq: $vendorId}, id: {_neq: $selfId}}) {
    id invoice_number amount po_id invoice_date
  }
  paid: invoices(where: {vendor_id: {_eq: $vendorId}, payment_status: {_eq: "paid"}}) {
    due_date
    payments(order_by: {paid_at: asc}, limit: 1) { paid_at }
  }
}
"""

_ZERO_UUID = "00000000-0000-0000-0000-000000000000"


async def fetch_context(vendor_id: str, self_id: str | None) -> tuple[list[dict], list[dict]]:
    data = await _gql(_CONTEXT, {"vendorId": vendor_id, "selfId": self_id or _ZERO_UUID})
    paid_history = [
        {"due_date": r["due_date"], "paid_at": (r["payments"][0]["paid_at"] if r["payments"] else None)}
        for r in data["paid"]
    ]
    return data["siblings"], paid_history


_WRITE_DUP = """
mutation WriteDup($invoiceId: uuid!, $obj: [duplicate_flags_insert_input!]!) {
  delete_duplicate_flags(where: {invoice_id: {_eq: $invoiceId}, method: {_eq: "rule_based"}}) {
    affected_rows
  }
  insert_duplicate_flags(objects: $obj) { affected_rows }
}
"""

_WRITE_DELAY = """
mutation WriteDelay($invoiceId: uuid!, $obj: delay_predictions_insert_input!) {
  delete_delay_predictions(where: {invoice_id: {_eq: $invoiceId}}) { affected_rows }
  insert_delay_predictions_one(object: $obj) { id }
}
"""


async def write_duplicate_flag(invoice_id: str, match) -> None:
    obj = (
        [{
            "invoice_id": invoice_id,
            "matched_invoice_id": match.matched_invoice_id,
            "confidence_score": match.confidence_score,
            "method": match.method,
            "reviewed_status": "unreviewed",
        }]
        if match
        else []
    )
    await _gql(_WRITE_DUP, {"invoiceId": invoice_id, "obj": obj})


async def write_delay_prediction(invoice_id: str, prediction: dict) -> None:
    await _gql(
        _WRITE_DELAY,
        {
            "invoiceId": invoice_id,
            "obj": {
                "invoice_id": invoice_id,
                "delay_probability": prediction["delay_probability"],
                "predicted_delay_days": prediction["predicted_delay_days"],
                "model_version": prediction["model_version"],
            },
        },
    )
