"""ml-service — duplicate detection + delay prediction.

  POST /score            Hasura event-trigger target (invoices INSERT/UPDATE).
                         Runs both checks, writes duplicate_flags / delay_predictions back.
  POST /check-duplicate  Hasura action target (checkDuplicateSync) — synchronous, no write.
  GET  /health
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException

from .delay import predict_delay
from .duplicates import detect
from .hasura import (
    HasuraError,
    fetch_context,
    write_delay_prediction,
    write_duplicate_flag,
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ml-service")
app = FastAPI(title="ml-service", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


def _from_event(body: dict) -> dict:
    new = (body.get("event", {}).get("data", {}) or {}).get("new")
    if not new:
        raise HTTPException(400, "not a Hasura event payload (event.data.new missing)")
    return new


def _from_action(body: dict) -> dict:
    inv = (body.get("input") or {}).get("invoice")
    if not inv:
        raise HTTPException(400, "action payload missing input.invoice")
    # action input is camelCase -> snake_case
    return {
        "id": None,
        "vendor_id": inv["vendorId"],
        "invoice_number": inv.get("invoiceNumber"),
        "amount": inv["amount"],
        "tax_amount": inv.get("taxAmount") or 0,
        "po_id": inv.get("poId"),
        "invoice_date": inv["invoiceDate"],
        "department": inv.get("department"),
    }


@app.post("/score")
async def score(body: dict) -> dict:
    inv = _from_event(body)
    try:
        siblings, paid_history = await fetch_context(inv["vendor_id"], inv.get("id"))
        match = detect(inv, siblings)
        await write_duplicate_flag(inv["id"], match)
        prediction = predict_delay(inv, paid_history)
        await write_delay_prediction(inv["id"], prediction)
    except HasuraError as exc:
        # 500 so Hasura retries the event per its retry_conf
        raise HTTPException(500, f"Hasura error while scoring: {exc}")

    log.info("scored %s: duplicate=%s delay=%s", inv.get("invoice_number"),
             bool(match), prediction["delay_probability"])
    return {
        "invoice_id": inv["id"],
        "duplicate": None if not match else {
            "matched_invoice_id": match.matched_invoice_id,
            "confidence_score": match.confidence_score,
            "method": match.method,
        },
        "delay_prediction": prediction,
    }


@app.post("/check-duplicate")
async def check_duplicate(body: dict) -> dict:
    inv = _from_action(body)
    try:
        siblings, _ = await fetch_context(inv["vendor_id"], None)
    except HasuraError as exc:
        raise HTTPException(502, f"Hasura error: {exc}")
    match = detect(inv, siblings)
    return {
        "isDuplicate": bool(match),
        "matchedInvoiceId": match.matched_invoice_id if match else None,
        "confidenceScore": match.confidence_score if match else None,
        "method": match.method if match else None,
        "reason": match.reason if match else "no matching invoice for this vendor",
    }
