"""genai-service's only call to another Python service (everything else in
this service talks to Hasura or its own genai_db). duplicate_flags moved to
ml-service's own private ml_db (see services/ml-service/app/db.py), so
/explain-duplicate has to ask ml-service for it directly now — a Hasura
relationship join can't reach across databases.
"""

from __future__ import annotations

import httpx

from .config import INTERNAL_SERVICE_TOKEN, ML_SERVICE_URL


async def get_duplicate_flag(invoice_id: str, company_id: str) -> dict | None:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{ML_SERVICE_URL}/duplicate-flags",
            params={"company_id": company_id, "invoice_ids": invoice_id},
            headers={"X-Internal-Token": INTERNAL_SERVICE_TOKEN},
        )
    resp.raise_for_status()
    return resp.json().get(invoice_id)
