"""genai-service — LLM summaries / explanations over the invoice data.

  POST /summarize         {question}     -> {summary, invoice_ids, query}
  POST /explain-duplicate {invoice_id}   -> {explanation, confidence_score, method}
  POST /extract-ocr       PDF upload     -> stubbed field guesses (pending review)
  GET  /health

Reads Hasura only as `genai_readonly` and only through the whitelist.
"""

from __future__ import annotations

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

from . import config, llm
from .hasura import HasuraError, fetch_duplicate_context, run_query
from .query_builder import build, route_offline, spec_from_tool_args
from .whitelist import NotAllowed

app = FastAPI(title="genai-service", version="0.1.0")


class SummarizeRequest(BaseModel):
    question: str


class ExplainRequest(BaseModel):
    invoice_id: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "llm": "offline" if config.OFFLINE else "azure-openai"}


@app.post("/summarize")
async def summarize(req: SummarizeRequest) -> dict:
    tool_args = None
    try:
        tool_args = llm.plan_query(req.question)  # None when OFFLINE or model declined
    except Exception as exc:  # LLM outage -> fall back to the offline router
        tool_args = None
        _ = exc

    if tool_args:
        try:
            spec = spec_from_tool_args(tool_args)
            what = f"{spec.table} matching the model's chosen filters"
        except (KeyError, ValueError, NotAllowed) as exc:
            raise HTTPException(422, f"model produced an invalid query: {exc}")
    else:
        spec, what = route_offline(req.question)

    try:
        query, variables = build(spec)
    except NotAllowed as exc:
        raise HTTPException(422, f"query not permitted: {exc}")

    try:
        data = await run_query(query, variables)
    except HasuraError as exc:
        raise HTTPException(502, f"Hasura error (as genai_readonly): {exc}")

    rows = data[spec.table]
    invoice_ids = _invoice_ids(spec.table, rows)
    return {
        "summary": llm.summarise(req.question, rows, what),
        "invoice_ids": invoice_ids,
        "row_count": len(rows),
        "query": {"table": spec.table, "what": what},
    }


@app.post("/explain-duplicate")
async def explain_duplicate(req: ExplainRequest) -> dict:
    try:
        ctx = await fetch_duplicate_context(req.invoice_id)
    except HasuraError as exc:
        raise HTTPException(502, f"Hasura error (as genai_readonly): {exc}")
    if ctx is None:
        raise HTTPException(404, "no duplicate flag on that invoice (nothing to explain)")
    flag = ctx["invoice"]["duplicateFlag"]
    return {
        "invoice_id": req.invoice_id,
        "matched_invoice_id": flag["matched_invoice_id"],
        "confidence_score": flag["confidence_score"],
        "method": flag["method"],
        "explanation": llm.explain_duplicate(ctx),
    }


@app.post("/extract-ocr")
async def extract_ocr(file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    # TODO: send `raw` to Azure Document Intelligence / a vision model; map the
    # response to per-field {value, confidence}. Until then, return an empty
    # skeleton so the UI can render a pending-review card rather than auto-commit.
    empty = {"value": None, "confidence": 0.0}
    return {
        "status": "pending_review",
        "note": "OCR/vision provider not wired — see TODO in app/main.py",
        "filename": file.filename,
        "size_bytes": len(raw),
        "fields": {
            "invoice_number": dict(empty),
            "vendor_name": dict(empty),
            "amount": dict(empty),
            "tax_amount": dict(empty),
            "invoice_date": dict(empty),
            "due_date": dict(empty),
            "department": dict(empty),
        },
    }


def _invoice_ids(table: str, rows: list[dict]) -> list[str]:
    if table == "invoices":
        return [r["id"] for r in rows if "id" in r]
    if table in ("duplicate_flags", "delay_predictions"):
        return [r["invoice_id"] for r in rows if r.get("invoice_id")]
    return []
