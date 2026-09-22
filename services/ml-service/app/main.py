"""ml-service — duplicate detection + delay prediction.

  POST /score            Hasura event-trigger target (invoices INSERT/UPDATE).
                         Runs both checks, writes duplicate_flags / delay_predictions back.
  POST /check-duplicate  Hasura action target (checkDuplicateSync) — synchronous, no write.
  POST /drift/check      Hasura cron-trigger target (ml_drift_check_daily) — checks both
                         models for drift, persists a report each, auto-retrains any that drifted.
  GET  /drift            Latest persisted drift report per model.
  POST /retrain          Manual retrain trigger, body {"model_name": "delay"|"duplicate"}.
  GET  /retrain-history   Recent retrain events.
  GET  /health
"""

from __future__ import annotations

import logging

from fastapi import Depends, FastAPI, HTTPException
from shared_types.auth import require_internal_token

from . import ModelUnavailable
from .config import MODEL_PATH
from .delay import model_info as delay_model_info
from .delay import predict_delay
from .duplicates import detect
from .duplicates import model_info as duplicate_model_info
from .hasura import (
    HasuraError,
    fetch_context,
    fetch_latest_drift,
    fetch_open_invoices,
    fetch_retrain_history,
    write_delay_prediction,
    write_duplicate_flag,
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ml-service")
app = FastAPI(title="ml-service", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/models", dependencies=[Depends(require_internal_token)])
def models(company_id: str) -> dict:
    """Technical details + accuracy/precision/recall for both models, scoped
    to one company (each reports whether it's that company's own trained
    model or the shared synthetic bootstrap) — consumed by the admin-only
    model status panel in the web app."""
    return {"duplicate": duplicate_model_info(company_id), "delay": delay_model_info(company_id)}


def _from_event(body: dict) -> dict:
    new = (body.get("event", {}).get("data", {}) or {}).get("new")
    if not new:
        raise HTTPException(400, "not a Hasura event payload (event.data.new missing)")
    return new


def _payment_status_changed(body: dict) -> bool:
    """True when this event is an UPDATE that flipped payment_status — which
    shifts the party's on-time rate, so their open invoices need re-scoring."""
    data = body.get("event", {}).get("data", {}) or {}
    old, new = data.get("old"), data.get("new")
    return bool(old) and bool(new) and old.get("payment_status") != new.get("payment_status")


def _party(inv: dict) -> tuple[str, str]:
    """(direction, party_id) — vendor for payables, customer for receivables."""
    direction = inv.get("direction") or "payable"
    party_id = inv.get("customer_id") if direction == "receivable" else inv.get("vendor_id")
    return direction, party_id


async def companies_with_trained_models() -> list[str]:
    """Company ids that have retrained at least one model of their own — a
    subdirectory under models/ existing is the ground truth for that,
    cheaper than asking Hasura and always in sync with what /score actually
    loads."""
    models_dir = MODEL_PATH.parent
    if not models_dir.exists():
        return []
    return [p.name for p in models_dir.iterdir() if p.is_dir()]


def _from_action(body: dict) -> dict:
    inv = (body.get("input") or {}).get("invoice")
    if not inv:
        raise HTTPException(400, "action payload missing input.invoice")
    # action input is camelCase -> snake_case
    return {
        "id": None,
        "company_id": inv.get("companyId"),
        "direction": inv.get("direction") or "payable",
        "vendor_id": inv.get("vendorId"),
        "customer_id": inv.get("customerId"),
        "invoice_number": inv.get("invoiceNumber"),
        "amount": inv["amount"],
        "tax_amount": inv.get("taxAmount") or 0,
        "po_id": inv.get("poId"),
        "invoice_date": inv["invoiceDate"],
        "department": inv.get("department"),
    }


@app.post("/score", dependencies=[Depends(require_internal_token)])
async def score(body: dict) -> dict:
    inv = _from_event(body)
    direction, party_id = _party(inv)
    company_id = inv["company_id"]
    rescored: list[str] = []
    try:
        siblings, paid_history = await fetch_context(party_id, inv.get("id"), company_id, direction)
        match = detect(inv, siblings, company_id)
        await write_duplicate_flag(inv["id"], company_id, match)

        # Delay risk is a receivables concern (will the customer pay us late?) —
        # a payable just needs its due date, already on the invoice. Skip the
        # model + write entirely rather than compute a prediction nobody reads.
        prediction = None
        if direction == "receivable":
            prediction = predict_delay(inv, paid_history, company_id)
            await write_delay_prediction(inv["id"], company_id, prediction)

            # A payment-status change moved this customer's on-time rate — re-score
            # their other still-open invoices with the fresh history. Writing
            # delay_predictions doesn't touch `invoices`, so no re-trigger loop.
            # ponytail: O(customer's open invoices) per payment; a nightly batch job
            # if one routinely carries hundreds open.
            if _payment_status_changed(body) and party_id:
                for other in await fetch_open_invoices(party_id, company_id, direction):
                    if other["id"] == inv["id"]:
                        continue
                    await write_delay_prediction(
                        other["id"], company_id, predict_delay(other, paid_history, company_id)
                    )
                    rescored.append(other["id"])
    except ModelUnavailable as exc:
        # no fallback — a missing/broken model is a deploy misconfig, not retryable
        raise HTTPException(503, str(exc))
    except HasuraError as exc:
        # 500 so Hasura retries the event per its retry_conf
        raise HTTPException(500, f"Hasura error while scoring: {exc}")

    log.info("scored %s: duplicate=%s delay=%s rescored_open=%d", inv.get("invoice_number"),
             bool(match), prediction["delay_probability"] if prediction else "n/a", len(rescored))
    return {
        "invoice_id": inv["id"],
        "duplicate": None if not match else {
            "matched_invoice_id": match.matched_invoice_id,
            "confidence_score": match.confidence_score,
            "method": match.method,
            "explanation": match.explanation,
        },
        "delay_prediction": prediction,
        "rescored_open_invoices": rescored,
    }


@app.post("/check-duplicate", dependencies=[Depends(require_internal_token)])
async def check_duplicate(body: dict) -> dict:
    inv = _from_action(body)
    if not inv.get("company_id"):
        raise HTTPException(400, "action payload missing input.invoice.companyId")
    direction, party_id = _party(inv)
    try:
        siblings, _ = await fetch_context(party_id, None, inv["company_id"], direction)
    except HasuraError as exc:
        raise HTTPException(502, f"Hasura error: {exc}")
    try:
        match = detect(inv, siblings, inv["company_id"])
    except ModelUnavailable as exc:
        raise HTTPException(503, str(exc))
    return {
        "isDuplicate": bool(match),
        "matchedInvoiceId": match.matched_invoice_id if match else None,
        "confidenceScore": match.confidence_score if match else None,
        "method": match.method if match else None,
        "reason": match.reason if match else "no matching invoice for this vendor",
        "explanation": match.explanation if match else [],
    }


@app.post("/drift/check", dependencies=[Depends(require_internal_token)])
async def drift_check(body: dict | None = None) -> dict:
    """Hasura cron-trigger target (ml_drift_check_daily) — no per-tenant
    context of its own, so it checks every company that has trained its own
    model (skipping ones still on the shared bootstrap — nothing can have
    drifted from data they were never trained on). A manual "check drift
    now" call with {"company_id": "..."} in the body checks just that one."""
    from .drift import check_all_drift

    body = body or {}
    company_id = body.get("company_id")
    if company_id:
        return {company_id: await check_all_drift(auto_retrain=True, company_id=company_id)}

    reports: dict[str, dict] = {}
    for cid in await companies_with_trained_models():
        reports[cid] = await check_all_drift(auto_retrain=True, company_id=cid)
    return reports


@app.get("/drift", dependencies=[Depends(require_internal_token)])
async def drift_status(company_id: str) -> dict:
    return await fetch_latest_drift(company_id)


@app.post("/retrain", dependencies=[Depends(require_internal_token)])
async def retrain(body: dict) -> dict:
    from .retrain import retrain_model

    model_name = body.get("model_name")
    company_id = body.get("company_id")
    if model_name not in ("delay", "duplicate"):
        raise HTTPException(400, 'body must include model_name: "delay" | "duplicate"')
    if not company_id:
        raise HTTPException(400, "body must include company_id")
    return await retrain_model(model_name, triggered_by="manual", company_id=company_id)


@app.get("/retrain-history", dependencies=[Depends(require_internal_token)])
async def retrain_history(company_id: str, limit: int = 20) -> list[dict]:
    return await fetch_retrain_history(company_id, limit)
