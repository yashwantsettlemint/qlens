"""Private Postgres connection for ml_drift_reports / ml_retrain_events —
ml-service's own `ml_db` database, never Hasura. Mirrors
services/auth-service/app/db.py's isolation pattern, but async: ml-service's
FastAPI routes are all `async def`, so a blocking psycopg.connect() here
would stall the event loop for every other concurrent request.

duplicate_flags / delay_predictions moved here too, in a second pass —
they used to be joined directly into the web app's invoice list/detail
queries (Hasura relationship on invoices), which is why that move needed
its own sign-off: the web app now fetches them in a separate batch call
(server/clients/mlService.ts's getDuplicateFlags/getDelayPredictions) and
stitches them onto the invoice rows itself. Two other callers that used to
reach these tables via Hasura were updated too:
- ml/train_duplicates.py's `--from-hasura` labeled-data loader (reads
  duplicate_flags from here directly now, then a small Hasura lookup for
  the invoice/matchedInvoice fields it still needs).
- genai-service's /explain-duplicate (services/genai-service/app/hasura.py's
  fetch_duplicate_context) now calls this service's GET /duplicate-flags
  instead of a Hasura relationship join.
genai-service's natural-language "ask" feature can no longer answer
questions that resolve to a direct duplicate_flags/delay_predictions query
(removed from its whitelist) — an accepted, deliberate degradation, not a
bug.

Falls back to PG_DATABASE_URL if ML_PG_DATABASE_URL isn't set, for any
deployment that hasn't picked up the migration yet.
"""

from __future__ import annotations

import os

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

DATABASE_URL = os.getenv("ML_PG_DATABASE_URL") or os.getenv("PG_DATABASE_URL", "")


async def get_conn() -> psycopg.AsyncConnection:
    if not DATABASE_URL:
        raise RuntimeError("ML_PG_DATABASE_URL (or PG_DATABASE_URL) is not set")
    return await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row, autocommit=True)


async def insert_drift_report(report: dict, company_id: str) -> None:
    async with await get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """INSERT INTO ml_drift_reports
                   (model_name, checked_at, drift_detected, feature_psi, rolling_metrics, baseline_metrics, notes, company_id)
                   VALUES (%(model_name)s, now(), %(drift_detected)s, %(feature_psi)s, %(rolling_metrics)s, %(baseline_metrics)s, %(notes)s, %(company_id)s)""",
                {
                    **report,
                    "feature_psi": Jsonb(report.get("feature_psi") or {}),
                    "rolling_metrics": Jsonb(report.get("rolling_metrics") or {}),
                    "baseline_metrics": Jsonb(report.get("baseline_metrics") or {}),
                    "company_id": company_id,
                },
            )


async def fetch_latest_drift(company_id: str) -> dict:
    async with await get_conn() as conn:
        async with conn.cursor() as cur:
            result = {}
            for model_name in ("duplicate", "delay"):
                await cur.execute(
                    """SELECT model_name, checked_at, drift_detected, feature_psi, rolling_metrics, baseline_metrics, notes
                       FROM ml_drift_reports
                       WHERE model_name = %s AND company_id = %s
                       ORDER BY checked_at DESC LIMIT 1""",
                    (model_name, company_id),
                )
                result[model_name] = await cur.fetchone()
            return result


async def insert_retrain_event(event: dict, company_id: str) -> str:
    async with await get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """INSERT INTO ml_retrain_events
                   (model_name, triggered_by, started_at, status, old_version, old_metrics, company_id)
                   VALUES (%(model_name)s, %(triggered_by)s, now(), %(status)s, %(old_version)s, %(old_metrics)s, %(company_id)s)
                   RETURNING id""",
                {
                    **event,
                    "old_metrics": Jsonb(event.get("old_metrics") or {}),
                    "company_id": company_id,
                },
            )
            row = await cur.fetchone()
            return str(row["id"])


async def update_retrain_event(event_id: str, patch: dict, company_id: str) -> None:
    async with await get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """UPDATE ml_retrain_events SET
                   status = COALESCE(%(status)s, status),
                   finished_at = COALESCE(%(finished_at)s, finished_at),
                   new_version = COALESCE(%(new_version)s, new_version),
                   new_metrics = COALESCE(%(new_metrics)s, new_metrics),
                   error = COALESCE(%(error)s, error)
                   WHERE id = %(id)s AND company_id = %(company_id)s""",
                {
                    "id": event_id,
                    "company_id": company_id,
                    "status": patch.get("status"),
                    "finished_at": patch.get("finished_at"),
                    "new_version": patch.get("new_version"),
                    "new_metrics": Jsonb(patch["new_metrics"]) if patch.get("new_metrics") is not None else None,
                    "error": patch.get("error"),
                },
            )


async def fetch_retrain_history(company_id: str, limit: int = 20) -> list[dict]:
    async with await get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """SELECT id, model_name, triggered_by, started_at, finished_at, status,
                          old_version, new_version, old_metrics, new_metrics, error
                   FROM ml_retrain_events
                   WHERE company_id = %s
                   ORDER BY started_at DESC LIMIT %s""",
                (company_id, limit),
            )
            rows = await cur.fetchall()
            for r in rows:
                r["id"] = str(r["id"])
            return rows


# --- duplicate_flags / delay_predictions --------------------------------------

async def write_duplicate_flag(invoice_id: str, company_id: str, match) -> None:
    """Same delete-unreviewed-then-insert-if-matched contract as the old
    Hasura mutation: clears any unreviewed flag for this invoice, then writes
    a fresh one only if `match` is truthy."""
    async with await get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM duplicate_flags WHERE invoice_id = %s AND reviewed_status = 'unreviewed'",
                (invoice_id,),
            )
            if match:
                await cur.execute(
                    """INSERT INTO duplicate_flags
                       (invoice_id, matched_invoice_id, confidence_score, method, reviewed_status, reason, explanation, company_id)
                       VALUES (%s, %s, %s, %s, 'unreviewed', %s, %s, %s)""",
                    (
                        invoice_id,
                        match.matched_invoice_id,
                        match.confidence_score,
                        match.method,
                        match.reason,
                        Jsonb(match.explanation or []),
                        company_id,
                    ),
                )


async def write_delay_prediction(invoice_id: str, company_id: str, prediction: dict) -> None:
    async with await get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("DELETE FROM delay_predictions WHERE invoice_id = %s", (invoice_id,))
            await cur.execute(
                """INSERT INTO delay_predictions
                   (invoice_id, delay_probability, predicted_delay_days, model_version, explanation, company_id)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (
                    invoice_id,
                    prediction["delay_probability"],
                    prediction["predicted_delay_days"],
                    prediction["model_version"],
                    Jsonb(prediction.get("explanation") or []),
                    company_id,
                ),
            )


async def get_duplicate_flags(company_id: str, invoice_ids: list[str]) -> dict[str, dict]:
    """One row per invoice_id that has a flag — {invoice_id: {...}}."""
    if not invoice_ids:
        return {}
    async with await get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """SELECT invoice_id, matched_invoice_id, confidence_score, method, reviewed_status, reason, explanation
                   FROM duplicate_flags WHERE company_id = %s AND invoice_id = ANY(%s)""",
                (company_id, invoice_ids),
            )
            rows = await cur.fetchall()
            return {str(r["invoice_id"]): r for r in rows}


async def get_delay_predictions(company_id: str, invoice_ids: list[str]) -> dict[str, dict]:
    """One row per invoice_id that has a prediction — {invoice_id: {...}}."""
    if not invoice_ids:
        return {}
    async with await get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """SELECT invoice_id, delay_probability, predicted_delay_days, model_version, explanation
                   FROM delay_predictions WHERE company_id = %s AND invoice_id = ANY(%s)""",
                (company_id, invoice_ids),
            )
            rows = await cur.fetchall()
            return {str(r["invoice_id"]): r for r in rows}


async def review_duplicate_flag(invoice_id: str, company_id: str, status: str) -> None:
    async with await get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE duplicate_flags SET reviewed_status = %s WHERE invoice_id = %s AND company_id = %s",
                (status, invoice_id, company_id),
            )
