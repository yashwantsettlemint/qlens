"""Runnable check:  python tests/test_rag_router.py

Runs with no Azure creds, so classify_question's ambiguous branch resolves via
the OFFLINE bias (-> 'structured')."""

import asyncio

import app.config as config
import app.llm as llm
import app.rag as rag
from app.query_builder import QuerySpec
from app.rag import OFF_TOPIC_ANSWER, answer_structured, classify_question, handle_query


def _check_off_topic_short_circuit() -> None:
    """A cleanly-declined LLM call (greeting / off-topic) must not fall through
    to the offline keyword router, which has no way to say "no match" and
    would otherwise answer with an arbitrary invoice list. A *failed* LLM call
    (network error, etc.) must still degrade to the offline router as before."""
    orig_offline = config.OFFLINE
    orig_plan = llm.plan_query
    orig_route_offline = rag._route_offline
    orig_run_query = rag.run_query
    try:
        config.OFFLINE = False

        llm.plan_query = lambda question: None  # simulate a clean decline
        result = asyncio.run(answer_structured("hi"))
        assert result == {"rows": [], "invoice_ids": [], "table": None, "what": "off_topic"}

        async def _stub_route_offline(question: str):
            return QuerySpec(table="invoices", limit=1), "stubbed offline route"

        async def _stub_run_query(query: str, variables: dict) -> dict:
            return {"invoices": []}

        def _boom(question: str) -> None:
            raise RuntimeError("network error")

        llm.plan_query = _boom
        rag._route_offline = _stub_route_offline
        rag.run_query = _stub_run_query
        result = asyncio.run(answer_structured("overdue invoices"))
        assert result["what"] == "stubbed offline route"  # degraded, not off_topic

        # same off-topic decline, but through handle_query() (the /query path
        # the Ask panel now calls) — must not fall through to synthesize()
        # with the off_topic sentinel disguised as a real (empty) result.
        llm.plan_query = lambda question: None
        hq = asyncio.run(handle_query("how many invoices are overdue"))
        assert hq["answer"] == OFF_TOPIC_ANSWER, hq
        assert hq["invoice_ids"] == [] and hq["structured"] is None and hq["semantic"] == []
    finally:
        config.OFFLINE = orig_offline
        llm.plan_query = orig_plan
        rag._route_offline = orig_route_offline
        rag.run_query = orig_run_query


def _check_invalid_llm_filter_degrades_to_offline() -> None:
    """The LLM has no way to know a vendor/customer's real row id, so it
    sometimes invents a non-existent filter column (e.g. "vendor_name"
    instead of "vendor_id"). That must degrade to the offline router, not
    escape as a raw NotAllowed that _safe_structured swallows into total
    silence ("No matching invoices" for an answerable question)."""
    orig_offline = config.OFFLINE
    orig_plan = llm.plan_query
    orig_run_query = rag.run_query
    try:
        config.OFFLINE = False
        llm.plan_query = lambda question: {
            "table": "invoices",
            "where": {"vendor_name": {"_eq": "State Bank of India"}},  # not a real column
        }

        async def _stub_run_query(query: str, variables: dict) -> dict:
            return {"vendors": []} if "vendors" in query else {"invoices": []}

        rag.run_query = _stub_run_query
        result = asyncio.run(answer_structured("payment pending from State Bank of India"))
        assert result["what"] != "off_topic"
        assert result["table"] == "invoices" and result["rows"] == []
    finally:
        config.OFFLINE = orig_offline
        llm.plan_query = orig_plan
        rag.run_query = orig_run_query


def _check_empty_semantic_falls_back_to_structured() -> None:
    """route == 'semantic' but the embedding search legitimately finds nothing
    (empty list, not unavailable) must still fall back to a real structured
    answer, not dead-end on "No matching invoices." for an answerable question."""
    orig_safe_semantic = rag._safe_semantic
    orig_safe_structured = rag._safe_structured
    try:
        async def _empty_semantic(question, top_k=5):
            return []  # ran fine, found nothing close — not None

        async def _real_structured(question):
            return {"rows": [{"id": "x"}], "invoice_ids": ["x"], "table": "invoices", "what": "stub"}

        rag._safe_semantic = _empty_semantic
        rag._safe_structured = _real_structured
        # "find invoices similar to X" is a pure lexical semantic hint — no LLM call
        result = asyncio.run(handle_query("find invoices similar to X"))
        assert result["route"] == "structured", result
        assert result["structured"] is not None, result
        assert result["invoice_ids"] == ["x"], result
    finally:
        rag._safe_semantic = orig_safe_semantic
        rag._safe_structured = orig_safe_structured


def run() -> None:
    assert config.OFFLINE, "test expects no AZURE_OPENAI_* set"
    _check_off_topic_short_circuit()
    _check_invalid_llm_filter_degrades_to_offline()
    _check_empty_semantic_falls_back_to_structured()

    # structured signals
    assert classify_question("what is the total exposure to Zensar?") == "structured"
    assert classify_question("how many invoices are overdue this month") == "structured"
    assert classify_question("average days to pay per vendor") == "structured"

    # semantic signals
    assert classify_question("find invoices similar to this one") == "semantic"
    assert classify_question("which invoices mention a late-delivery penalty") == "semantic"

    # both
    assert classify_question("total amount for invoices similar to INV-1") == "both"

    # ambiguous -> OFFLINE bias to structured (safer than a wrong semantic guess)
    assert classify_question("tell me about vendor payments") == "structured"

    print("genai-service rag router: all checks passed")


if __name__ == "__main__":
    run()
