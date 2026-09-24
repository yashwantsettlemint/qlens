"""ocr-service — CPU OCR + field extraction for digital and scanned invoices.

  POST /extract              PDF or image upload
                              -> {extracted_fields, source_map, direction, counterparty_name,
                                  direction_detected, valid, issues, review_queue_id}
  POST /bulk/enqueue          multipart files[] -> queue each over RabbitMQ, return job ids
  GET  /bulk/status?ids=...   -> per-job status/result
  GET  /health

Per page: real text layer -> use it directly; otherwise preprocess + PaddleOCR
PP-StructureV3 (CPU). Fields come from an LLM tool call (regex fallback offline),
with OCR-sourced confidences capped at the page's OCR confidence. `valid` is
false -> the draft is written to `review_queue` (admin) instead of `invoices`;
the caller commits valid single-document drafts itself. Bulk uploads (app/bulk.py)
always land in review_queue — see pipeline.process_document.
"""

from __future__ import annotations

import asyncio

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from shared_types.logging import configure_logging
from shared_types.secrets_check import assert_production_secrets_configured
from shared_types.auth import require_internal_token

from . import bulk, config, ocr_engine, pipeline

configure_logging("ocr-service")
assert_production_secrets_configured("HASURA_GRAPHQL_JWT_SECRET", "INTERNAL_SERVICE_TOKEN")
app = FastAPI(title="ocr-service", version="0.1.0")


@app.on_event("startup")
async def _start_bulk_consumer() -> None:
    asyncio.create_task(bulk.start_consumer())


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "ocr": "loaded" if ocr_engine._engine is not None else "lazy",
        "llm": "offline" if config.OFFLINE else "azure-openai",
    }


@app.post("/bulk/enqueue", dependencies=[Depends(require_internal_token)])
async def bulk_enqueue(files: list[UploadFile] = File(...), company_id: str = Form(...)) -> list[dict]:
    jobs = []
    for f in files:
        raw = await f.read()
        if not raw:
            continue
        job_id = await bulk.enqueue(raw, f.filename or "upload", company_id)
        jobs.append({"job_id": job_id, "filename": f.filename, "status": "queued"})
    if not jobs:
        raise HTTPException(400, "no files uploaded")
    return jobs


@app.get("/bulk/status", dependencies=[Depends(require_internal_token)])
async def bulk_status(ids: str) -> list[dict]:
    return [j for j in (bulk.job_status(i) for i in ids.split(",") if i) if j]


@app.post("/extract-text", dependencies=[Depends(require_internal_token)])
async def extract_text_endpoint(file: UploadFile = File(...)) -> dict:
    """Raw text only — text layer for digital PDFs, OCR for scans/images. No field
    extraction, no validation, no review queue."""
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty upload")
    combined, engine_err = pipeline.read_document(raw, file.content_type)
    return {
        "text": combined["full_text"],
        "source_map": combined["source_map"],
        "pages": len(combined["source_map"]),
        "chars": len(combined["full_text"]),
        "filename": file.filename,
        "size_bytes": len(raw),
        "note": engine_err if not combined["full_text"] else None,
    }


@app.post("/extract", dependencies=[Depends(require_internal_token)])
async def extract_endpoint(file: UploadFile = File(...), company_id: str = Form(...)) -> dict:
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty upload")
    return await pipeline.process_document(raw, file.filename, file.content_type, company_id)
