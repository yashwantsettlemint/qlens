"""genai-service — LLM summaries / explanations + hybrid RAG over the invoice data.

  POST /summarize         {question}     -> structured (text->GraphQL) answer
  POST /query             {question}     -> hybrid: structured and/or semantic (pgvector), merged
  POST /embed             event payload  -> (re)build the invoice's embedding row
  POST /explain-duplicate {invoice_id}   -> {explanation, confidence_score, method}
  POST /summarize-invoice {invoice_id}   -> {summary} — plain-language "what is this invoice"
  POST /extract-ocr       PDF upload     -> invoice fields from the PDF text layer
  GET  /health

Reads Hasura as `genai_readonly` (and only through the whitelist / tracked
functions). The sole exception is /embed, which uses the admin secret to read
full invoice context and write invoice_embeddings.
"""

from __future__ import annotations

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel
from shared_types.auth import require_internal_token

from . import chunking, config, embedding, llm, ocr, rag
from .hasura import (
    HasuraError,
    fetch_duplicate_context,
    fetch_invoice_full,
    fetch_invoice_summary_context,
    list_invoice_ids,
    replace_embeddings,
)
from .whitelist import NotAllowed

app = FastAPI(title="genai-service", version="0.2.0")


class SummarizeRequest(BaseModel):
    question: str
    company_id: str


class QueryRequest(BaseModel):
    question: str
    company_id: str


class ExplainRequest(BaseModel):
    invoice_id: str
    company_id: str


class InvoiceSummaryRequest(BaseModel):
    invoice_id: str
    company_id: str


@app.get("/health")
def health() -> dict:
    if config.OFFLINE:
        provider = "offline"
    elif config.LLM_BASE_URL:
        provider = "openai-compatible"
    else:
        provider = "azure-openai"
    return {"status": "ok", "llm": provider}


@app.post("/summarize", dependencies=[Depends(require_internal_token)])
async def summarize(req: SummarizeRequest) -> dict:
    try:
        res = await rag.answer_structured(req.question, req.company_id)
    except NotAllowed as exc:
        raise HTTPException(422, f"query not permitted: {exc}")
    except HasuraError as exc:
        raise HTTPException(502, f"Hasura error (as genai_readonly): {exc}")
    if res["what"] == "off_topic":
        return {
            "summary": rag.OFF_TOPIC_ANSWER,
            "invoice_ids": [],
            "row_count": 0,
            "query": {"table": None, "what": "off_topic"},
        }
    return {
        "summary": llm.summarise(req.question, res["rows"], res["what"]),
        "invoice_ids": res["invoice_ids"],
        "row_count": len(res["rows"]),
        "query": {"table": res["table"], "what": res["what"]},
    }


@app.post("/query", dependencies=[Depends(require_internal_token)])
async def query(req: QueryRequest) -> dict:
    """Hybrid router — structured (exact, from Postgres) and/or semantic
    (pgvector similarity), merged into one answer."""
    return await rag.handle_query(req.question, req.company_id)


async def _embed_one(invoice_id: str) -> dict:
    """Fetch, chunk, embed and upsert one invoice. Never raises for a missing
    invoice or an unavailable embedding model — both come back as {"status":
    "skipped"} so callers (the Hasura event trigger, the backfill sweep) can
    keep going instead of treating it as fatal."""
    try:
        inv = await fetch_invoice_full(invoice_id)
    except HasuraError as exc:
        return {"status": "failed", "reason": f"Hasura error: {exc}", "invoice_id": invoice_id}
    if inv is None:
        return {"status": "skipped", "reason": "invoice not found", "invoice_id": invoice_id}

    texts = chunking.invoice_to_chunks(inv)
    try:
        vecs = [embedding.embed(t) for t in texts]
    except embedding.EmbeddingUnavailable as exc:
        return {"status": "skipped", "reason": str(exc), "invoice_id": invoice_id}

    try:
        chunks = [(t, embedding.vector_literal(v)) for t, v in zip(texts, vecs)]
        await replace_embeddings(invoice_id, chunks, inv["company_id"])
    except HasuraError as exc:
        return {"status": "failed", "reason": f"embedding upsert failed: {exc}", "invoice_id": invoice_id}
    return {
        "status": "embedded",
        "invoice_id": invoice_id,
        "chunks": len(texts),
        "chunk_chars": [len(t) for t in texts],
        "dim": len(vecs[0]) if vecs else 0,
    }


@app.post("/embed", dependencies=[Depends(require_internal_token)])
async def embed_invoice(body: dict) -> dict:
    """Hasura event-trigger target (invoices INSERT/UPDATE). Also callable
    manually as {"invoice_id": "..."}. Returns 200 for 'skip'/'failed' so
    Hasura does not retry a permanent failure forever — a transient Hasura
    error is the one case worth a 500 so Hasura's own retry_conf kicks in."""
    invoice_id = _embed_target(body)
    result = await _embed_one(invoice_id)
    if result["status"] == "failed" and "Hasura error" in result["reason"]:
        raise HTTPException(502, result["reason"])
    return result


@app.post("/embed/backfill", dependencies=[Depends(require_internal_token)])
async def embed_backfill() -> dict:
    """Re-embeds every invoice — catches up anything the event trigger missed
    (seed data inserted before this service was healthy, or the embedding
    model failing to load at the time) and re-chunks existing invoices with
    the current, richer chunk format. Safe to run repeatedly: upsert_embedding
    overwrites the existing row per invoice, so there's no duplicate risk.

    ponytail: re-embeds ALL invoices rather than just the ones missing a row —
    simplest correct thing for this app's data volume. If that gets slow,
    switch to a query that anti-joins invoice_embeddings.
    """
    try:
        ids = await list_invoice_ids()
    except HasuraError as exc:
        raise HTTPException(502, f"Hasura error: {exc}")

    embedded = skipped = failed = 0
    reasons: dict[str, int] = {}
    for invoice_id in ids:
        result = await _embed_one(invoice_id)
        if result["status"] == "embedded":
            embedded += 1
        elif result["status"] == "skipped":
            skipped += 1
            reasons[result["reason"]] = reasons.get(result["reason"], 0) + 1
        else:
            failed += 1
            reasons[result["reason"]] = reasons.get(result["reason"], 0) + 1

    return {"total": len(ids), "embedded": embedded, "skipped": skipped, "failed": failed, "reasons": reasons}


@app.post("/explain-duplicate", dependencies=[Depends(require_internal_token)])
async def explain_duplicate(req: ExplainRequest) -> dict:
    try:
        ctx = await fetch_duplicate_context(req.invoice_id, req.company_id)
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


@app.post("/summarize-invoice", dependencies=[Depends(require_internal_token)])
async def summarize_invoice(req: InvoiceSummaryRequest) -> dict:
    try:
        inv = await fetch_invoice_summary_context(req.invoice_id, req.company_id)
    except HasuraError as exc:
        raise HTTPException(502, f"Hasura error (as genai_readonly): {exc}")
    if inv is None:
        raise HTTPException(404, "invoice not found")
    return {"summary": llm.summarise_invoice(inv)}


@app.post("/extract-ocr", dependencies=[Depends(require_internal_token)])
async def extract_ocr(file: UploadFile = File(...)) -> dict:
    """Read invoice fields from an uploaded PDF's text layer (LLM, or offline
    regex). Image / scanned PDFs have no text layer and get a pending-review
    skeleton — full OCR lives in services/ocr-service (see docs/ocr-design.md)."""
    raw = await file.read()
    text = ocr.pdf_text(raw)
    if not text:
        return {
            "status": "pending_review",
            "note": "No text layer — scanned documents are handled by services/ocr-service.",
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


def _embed_target(body: dict) -> str:
    new = (body.get("event", {}).get("data", {}) or {}).get("new")
    if isinstance(new, dict) and new.get("id"):
        return new["id"]
    if body.get("invoice_id"):
        return body["invoice_id"]
    raise HTTPException(400, "expected a Hasura event payload or {invoice_id}")
