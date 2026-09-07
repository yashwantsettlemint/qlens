"""notification-service — target of the `overdue_sweep_daily` Hasura cron trigger.

  POST /overdue-sweep   -> mark unpaid past-due invoices `overdue`, send a digest
  GET  /health
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from fastapi import FastAPI, HTTPException

from .hasura import HasuraError, find_past_due, mark_overdue
from .notify import format_digest, get_notifier

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="notification-service", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/overdue-sweep")
async def overdue_sweep() -> dict:
    today = date.today().isoformat()
    try:
        rows = await find_past_due(today)
        swept = await mark_overdue([r["id"] for r in rows])
    except HasuraError as exc:
        raise HTTPException(502, f"Hasura error during sweep: {exc}")

    subject, body = format_digest(rows)
    get_notifier().send(subject, body)
    return {
        "ran_at": datetime.now(timezone.utc).isoformat(),
        "as_of": today,
        "swept": swept,
        "invoice_ids": [r["id"] for r in rows],
        "digest_subject": subject,
    }
