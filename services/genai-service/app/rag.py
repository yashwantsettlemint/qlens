"""Hybrid query routing.

Aggregation / filter questions ("total exposure to X", "how many overdue") have
exact answers in Postgres — they go through the text-to-GraphQL path, never
vector search. Vector search is only for genuinely semantic questions ("similar
to this one", "invoices that mention a penalty"). Ambiguous questions fall to an
LLM classifier that is biased toward `structured` — a wrong structured query is
easy to spot; a wrong semantic guess presented as fact is not.
"""

from __future__ import annotations

from . import config, embedding, llm
from .hasura import HasuraError, match_embeddings, run_query
from .query_builder import build, route_offline, spec_from_tool_args
from .whitelist import NotAllowed

_STRUCTURED_HINTS = (
    "total", "how many", "how much", "sum of", "count", "average", "avg ",
    "number of", "list all", "overdue", "aggregate", "breakdown",
    "per vendor", "per department",
)
_SEMANTIC_HINTS = (
    "similar to", "like this", "mention", "related to", "resembl",
    "find invoices that", "sounds like", "same kind of",
)


def classify_question(question: str) -> str:
    """-> 'structured' | 'semantic' | 'both'."""
    ql = question.lower()
    s = any(k in ql for k in _STRUCTURED_HINTS)
    m = any(k in ql for k in _SEMANTIC_HINTS)
    if s and not m:
        return "structured"
    if m and not s:
        return "semantic"
    if s and m:
        return "both"
    return llm.classify_route(question)  # ambiguous — LLM, biased to 'structured'


def _invoice_ids(table: str, rows: list[dict]) -> list[str]:
    if table == "invoices":
        return [r["id"] for r in rows if "id" in r]
    if table in ("duplicate_flags", "delay_predictions"):
        return [r["invoice_id"] for r in rows if r.get("invoice_id")]
    return []


_VENDORS_Q = "query { vendors { id name } }"


async def _route_offline(question: str, company_id: str):
    """route_offline + a live vendor list so 'invoices from <vendor>' works offline."""
    try:
        vendors = (await run_query(_VENDORS_Q, {}, company_id))["vendors"]
    except HasuraError:
        vendors = []
    return route_offline(question, vendors)


async def answer_structured(question: str, company_id: str) -> dict:
    """Text -> whitelisted GraphQL -> rows. Returns
    {rows, invoice_ids, table, what}, or {"what": "off_topic"} when an online
    LLM was asked and declined (greeting / not about the data) — that must not
    fall through to the offline router, which has no way to say "no match" and
    would otherwise hand back an arbitrary invoice list. Raises NotAllowed /
    HasuraError."""
    tool_args = None
    llm_call_failed = False
    try:
        tool_args = llm.plan_query(question)  # None when OFFLINE / model declined
    except Exception:
        llm_call_failed = True

    if tool_args is None and not config.OFFLINE and not llm_call_failed:
        return {"rows": [], "invoice_ids": [], "table": None, "what": "off_topic"}

    if tool_args:
        try:
            spec = spec_from_tool_args(tool_args)
            what = f"{spec.table} matching the model's chosen filters"
            query, variables = build(spec)  # NotAllowed — e.g. the LLM invents a
            # column that isn't real (it has no way to know a party's row id,
            # so it sometimes guesses a filter like "vendor_name" that doesn't
            # exist as an actual column). Must degrade here too, not just when
            # spec_from_tool_args() itself fails, or this silently becomes
            # "No matching invoices" for an answerable question.
        except (KeyError, ValueError, NotAllowed):
            spec, what = await _route_offline(question, company_id)  # degrade, don't 422
            query, variables = build(spec)
    else:
        spec, what = await _route_offline(question, company_id)
        query, variables = build(spec)

    data = await run_query(query, variables, company_id)  # HasuraError
    rows = data[spec.table]
    return {
        "rows": rows,
        "invoice_ids": _invoice_ids(spec.table, rows),
        "table": spec.table,
        "what": what,
    }


async def _safe_structured(question: str, company_id: str) -> dict | None:
    try:
        return await answer_structured(question, company_id)
    except (HasuraError, NotAllowed):
        return None


# match_invoice_embeddings always returns exactly top_k rows (nearest neighbors,
# not "good enough" ones) — without a floor, a question with no real match still
# comes back with 5 barely-related invoices padded on. Chosen from observed
# scores: a genuinely on-topic match lands ~0.5+, unrelated ones ~0.3-0.4.
_MIN_SIMILARITY = 0.45


async def _safe_semantic(question: str, company_id: str, top_k: int = 5) -> list[dict] | None:
    try:
        vec = embedding.embed(question)
    except embedding.EmbeddingUnavailable:
        return None
    try:
        # An invoice can now have several chunks (one per page-window), so a
        # single invoice could otherwise fill the whole top_k with its own
        # chunks — over-fetch raw chunk matches, then keep each invoice's
        # single best-scoring chunk, so results are still top_k *invoices*.
        raw = await match_embeddings(embedding.vector_literal(vec), company_id, top_k * 4)
    except HasuraError:
        return None
    best_by_invoice: dict[str, dict] = {}
    for m in raw:
        prev = best_by_invoice.get(m["invoice_id"])
        if prev is None or m["similarity"] > prev["similarity"]:
            best_by_invoice[m["invoice_id"]] = m
    matches = sorted(best_by_invoice.values(), key=lambda m: -m["similarity"])[:top_k]
    return [m for m in matches if m["similarity"] >= _MIN_SIMILARITY]


OFF_TOPIC_ANSWER = (
    "I can only help with questions about your invoices, vendors, customers, "
    "payments and predictions — try something like \"overdue invoices\" or "
    "\"top vendors by exposure\"."
)


async def handle_query(question: str, company_id: str) -> dict:
    route = classify_question(question)
    structured = semantic = None

    if route in ("structured", "both"):
        structured = await _safe_structured(question, company_id)
        if structured and structured.get("what") == "off_topic":
            # a clean LLM decline (greeting / not about the data) — don't feed
            # this to synthesize() as if it were a real (empty) result, and
            # don't fall through to a semantic search for "hi".
            return {
                "answer": OFF_TOPIC_ANSWER,
                "route": route,
                "invoice_ids": [],
                "structured": None,
                "semantic": [],
            }

    if route in ("semantic", "both"):
        semantic = await _safe_semantic(question, company_id)
        if not semantic and route == "semantic":
            # embeddings unavailable, OR the search legitimately found nothing
            # close enough -> fall back to the structured answer rather than
            # dead-ending on "No matching invoices." for a real question.
            route = "structured"
            structured = await _safe_structured(question, company_id)

    answer = llm.synthesize(question, structured, semantic)

    ids: list[str] = []
    if structured:
        ids += structured["invoice_ids"]
    if semantic:
        ids += [r["invoice_id"] for r in semantic]
    seen: set[str] = set()
    invoice_ids = [i for i in ids if not (i in seen or seen.add(i))]

    return {
        "answer": answer,
        "route": route,
        "invoice_ids": invoice_ids,
        "structured": None
        if not structured
        else {
            "table": structured["table"],
            "what": structured["what"],
            "row_count": len(structured["rows"]),
        },
        "semantic": []
        if not semantic
        else [
            {
                "invoice_id": r["invoice_id"],
                "similarity": round(float(r["similarity"]), 4),
                "text": r["chunk_text"],
            }
            for r in semantic
        ],
    }
