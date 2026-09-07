"""genai-service — LLM summaries / explanations over the invoice data.

  POST /summarize         {question}     -> {summary, invoice_ids, query}
  POST /explain-duplicate {invoice_id}   -> {explanation, confidence_score, method}
  POST /extract-ocr       PDF upload     -> invoice fields from the PDF text layer
                                            (LLM or offline regex); image PDFs -> pending review
  GET  /health

Reads Hasura only as `genai_readonly` and only through the whitelist.
"""

from __future__ import annotations

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

from . import config, llm, ocr
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
    """Read invoice fields from an uploaded PDF's text layer (LLM, or offline
    regex). Image / scanned PDFs have no text layer and get a pending-review
    skeleton — real OCR needs a vision provider (see app/ocr.py)."""
    raw = await file.read()
    text = ocr.pdf_text(raw)
    if not text:
        return {
            "status": "pending_review",
            "note": "No text layer — image / scanned documents need an OCR / vision "
                    "provider, which is not wired (see app/ocr.py).",
            "filename": file.filename,
            "size_bytes": len(raw),
            "fields": ocr.empty_fields(),
        }

    fields = None
    try:
        fields = llm.extract_invoice_fields(text)
    except Exception:  # LLM outage -> offline regex
        fields = None
    source = "llm"
    if fields is None:
        fields, source = ocr.regex_fields(text), "regex"

    filled = sum(1 for f in fields.values() if f["value"] not in (None, ""))
    return {
        "status": "extracted" if filled else "pending_review",
        "source": source,
        "filename": file.filename,
        "size_bytes": len(raw),
        "fields": fields,
    }


def _invoice_ids(table: str, rows: list[dict]) -> list[str]:
    if table == "invoices":
        return [r["id"] for r in rows if "id" in r]
    if table in ("duplicate_flags", "delay_predictions"):
        return [r["invoice_id"] for r in rows if r.get("invoice_id")]
    return []
