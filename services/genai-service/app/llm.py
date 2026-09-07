"""Azure OpenAI wrapper with a deterministic offline fallback.

When AZURE_OPENAI_* is unset (config.OFFLINE), every function returns a templated
answer so the service is fully demoable with no credentials.
"""

from __future__ import annotations

from . import config

_SUMMARISE_TOOL = {
    "type": "function",
    "function": {
        "name": "query_invoices",
        "description": "Query the invoice database. Only whitelisted tables/fields.",
        "parameters": {
            "type": "object",
            "properties": {
                "table": {"type": "string", "enum": ["invoices", "vendors", "duplicate_flags", "delay_predictions"]},
                "where": {"type": "object", "description": "Hasura bool_exp, e.g. {\"payment_status\":{\"_eq\":\"overdue\"}}"},
                "order_by": {"type": "object"},
                "limit": {"type": "integer"},
                "include": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["table"],
        },
    },
}


def _client():
    from openai import AzureOpenAI

    return AzureOpenAI(
        azure_endpoint=config.AZURE_OPENAI_ENDPOINT,
        api_key=config.AZURE_OPENAI_KEY,
        api_version=config.AZURE_OPENAI_API_VERSION,
    )


def plan_query(question: str) -> dict | None:
    """LLM decides which whitelisted query answers the question. Returns tool args
    dict, or None to signal 'use the offline router'."""
    if config.OFFLINE:
        return None
    resp = _client().chat.completions.create(
        model=config.AZURE_OPENAI_DEPLOYMENT,
        messages=[
            {"role": "system", "content": "Pick one query_invoices call that best answers the user. Do not answer directly."},
            {"role": "user", "content": question},
        ],
        tools=[_SUMMARISE_TOOL],
        tool_choice={"type": "function", "function": {"name": "query_invoices"}},
        temperature=0,
    )
    calls = resp.choices[0].message.tool_calls or []
    return None if not calls else __import__("json").loads(calls[0].function.arguments)


def summarise(question: str, rows: list[dict], what: str) -> str:
    if config.OFFLINE or not rows:
        return _offline_summary(question, rows, what)
    resp = _client().chat.completions.create(
        model=config.AZURE_OPENAI_DEPLOYMENT,
        messages=[
            {"role": "system", "content": "Summarise the rows in 2-4 plain sentences for a finance user. Use the numbers given; do not invent."},
            {"role": "user", "content": f"Question: {question}\nRows ({what}):\n{rows}"},
        ],
        temperature=0.2,
    )
    return resp.choices[0].message.content.strip()


def explain_duplicate(ctx: dict) -> str:
    inv, matched, flag = ctx["invoice"], ctx.get("matched"), ctx["invoice"]["duplicateFlag"]
    facts = (
        f"{inv['invoice_number']} (vendor {inv['vendor']['name']}, "
        f"₹{float(inv['amount']):,.0f}+₹{float(inv['tax_amount']):,.0f} tax, dated {inv['invoice_date']}) "
        f"was flagged against "
        + (
            f"{matched['invoice_number']} (₹{float(matched['amount']):,.0f}, dated {matched['invoice_date']})"
            if matched
            else "another invoice"
        )
        + f". Method: {flag['method']}. Confidence: {float(flag['confidence_score']):.0%}. "
        f"Review status: {flag['reviewed_status']}."
    )
    if config.OFFLINE:
        return (
            f"{facts} The match was made on close amounts and invoice-date proximity, plus a "
            f"similar invoice number or a shared purchase order. This explains the existing "
            f"flag only — it does not assert a new match."
        )
    resp = _client().chat.completions.create(
        model=config.AZURE_OPENAI_DEPLOYMENT,
        messages=[
            {"role": "system", "content": "Explain, in plain language, why this invoice was flagged as a likely duplicate. Use ONLY the facts provided. Do not re-derive or assert a new match."},
            {"role": "user", "content": facts},
        ],
        temperature=0.2,
    )
    return resp.choices[0].message.content.strip()


def _offline_summary(question: str, rows: list[dict], what: str) -> str:
    n = len(rows)
    if n == 0:
        return f"No records match that ({what})."
    amounts = [float(r["amount"]) for r in rows if "amount" in r]
    probs = [float(r["delay_probability"]) for r in rows if "delay_probability" in r]
    bits = [f"{n} record(s) for: {what}."]
    if amounts:
        bits.append(f"They total ₹{sum(amounts):,.0f}; largest ₹{max(amounts):,.0f}.")
    if probs:
        bits.append(f"Modelled late-payment probability ranges {min(probs):.0%}–{max(probs):.0%}.")
    return " ".join(bits)
