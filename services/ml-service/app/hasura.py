"""Hasura access for ml-service. Reads context (vendor's other invoices, vendor
payment history) and writes results back to duplicate_flags / delay_predictions
as `ml_service` — a company-scoped role, self-minted per call (see
hasura/metadata's ml_service permissions), not the admin secret.
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


_WRITE_DUP = """
mutation WriteDup($invoiceId: uuid!, $obj: [duplicate_flags_insert_input!]!) {
  delete_duplicate_flags(where: {invoice_id: {_eq: $invoiceId}, reviewed_status: {_eq: "unreviewed"}}) {
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


async def write_duplicate_flag(invoice_id: str, company_id: str, match) -> None:
    obj = (
        [{
            "invoice_id": invoice_id,
            # company_id is NOT sent here — it's forced server-side by the
            # ml_service role's insert `set` preset (a column in `set` isn't
            # a valid field on the generated *_insert_input type at all).
            "matched_invoice_id": match.matched_invoice_id,
            "confidence_score": match.confidence_score,
            "method": match.method,
            "reviewed_status": "unreviewed",
            "reason": match.reason,
            # jsonb GraphQL variables take the JSON value directly — json.dumps()
            # here would double-encode it into a jsonb *string*, not an array,
            # breaking every reader that expects a list (e.g. GraphQL clients).
            "explanation": match.explanation,
        }]
        if match
        else []
    )
    await _gql(_WRITE_DUP, {"invoiceId": invoice_id, "obj": obj}, company_id)


async def write_delay_prediction(invoice_id: str, company_id: str, prediction: dict) -> None:
    await _gql(
        _WRITE_DELAY,
        {
            "invoiceId": invoice_id,
            "obj": {
                "invoice_id": invoice_id,
                "delay_probability": prediction["delay_probability"],
                "predicted_delay_days": prediction["predicted_delay_days"],
                "model_version": prediction["model_version"],
                "explanation": prediction.get("explanation") or [],
            },
        },
        company_id,
    )


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


_INSERT_DRIFT = """
mutation InsertDrift($obj: ml_drift_reports_insert_input!) {
  insert_ml_drift_reports_one(object: $obj) { id }
}
"""


async def insert_drift_report(report: dict, company_id: str) -> None:
    # company_id isn't sent in `report` — it's forced server-side by the
    # ml_service role's insert `set` preset.
    await _gql(_INSERT_DRIFT, {"obj": report}, company_id)


_INSERT_RETRAIN = """
mutation InsertRetrain($obj: ml_retrain_events_insert_input!) {
  insert_ml_retrain_events_one(object: $obj) { id }
}
"""

_UPDATE_RETRAIN = """
mutation UpdateRetrain($id: uuid!, $set: ml_retrain_events_set_input!) {
  update_ml_retrain_events_by_pk(pk_columns: {id: $id}, _set: $set) { id }
}
"""


async def insert_retrain_event(event: dict, company_id: str) -> str:
    # company_id isn't sent in `event` — it's forced server-side by the
    # ml_service role's insert `set` preset.
    data = await _gql(_INSERT_RETRAIN, {"obj": event}, company_id)
    return data["insert_ml_retrain_events_one"]["id"]


async def update_retrain_event(event_id: str, patch: dict, company_id: str) -> None:
    await _gql(_UPDATE_RETRAIN, {"id": event_id, "set": patch}, company_id)


_LATEST_DRIFT = """
query LatestDrift($companyId: uuid!) {
  duplicate: ml_drift_reports(
    where: {model_name: {_eq: "duplicate"}, company_id: {_eq: $companyId}}, order_by: {checked_at: desc}, limit: 1
  ) { model_name checked_at drift_detected feature_psi rolling_metrics baseline_metrics notes }
  delay: ml_drift_reports(
    where: {model_name: {_eq: "delay"}, company_id: {_eq: $companyId}}, order_by: {checked_at: desc}, limit: 1
  ) { model_name checked_at drift_detected feature_psi rolling_metrics baseline_metrics notes }
}
"""


async def fetch_latest_drift(company_id: str) -> dict:
    data = await _gql(_LATEST_DRIFT, {"companyId": company_id}, company_id)
    return {
        "duplicate": (data["duplicate"] or [None])[0],
        "delay": (data["delay"] or [None])[0],
    }


_RETRAIN_HISTORY = """
query RetrainHistory($limit: Int!, $companyId: uuid!) {
  ml_retrain_events(
    where: {company_id: {_eq: $companyId}}, order_by: {started_at: desc}, limit: $limit
  ) {
    id model_name triggered_by started_at finished_at status
    old_version new_version old_metrics new_metrics error
  }
}
"""


async def fetch_retrain_history(company_id: str, limit: int = 20) -> list[dict]:
    data = await _gql(_RETRAIN_HISTORY, {"limit": limit, "companyId": company_id}, company_id)
    return data["ml_retrain_events"]
