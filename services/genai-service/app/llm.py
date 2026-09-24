"""LLM wrapper — any OpenAI-compatible endpoint (Groq, OpenAI, Ollama, …) via
`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`, or Azure OpenAI via `AZURE_OPENAI_*`.

When no LLM is configured (config.OFFLINE), every function returns a templated /
keyword-routed answer so the service is fully demoable with no credentials.
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
                "table": {"type": "string", "enum": ["invoices", "vendors"]},
                "where": {
                    "type": "object",
                    "description": (
                        "Hasura bool_exp on the whitelisted columns. payment_status is only "
                        "ever 'paid' or 'unpaid' (never 'overdue' — that's derived, not stored); "
                        "approval_status is 'pending' | 'approved' | 'rejected'. For 'overdue' "
                        "invoices, filter payment_status _neq 'paid' AND due_date _lt today's "
                        "date (YYYY-MM-DD), e.g. "
                        '{"payment_status":{"_neq":"paid"},"due_date":{"_lt":"2026-01-01"}}'
                    ),
                },
                "order_by": {"type": "object"},
                "limit": {"type": "integer"},
                "include": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["table"],
        },
    },
}


def _client():
    if config.LLM_BASE_URL:  # Groq / OpenAI / Ollama / any OpenAI-compatible endpoint
        from openai import OpenAI

        return OpenAI(base_url=config.LLM_BASE_URL, api_key=config.LLM_API_KEY or "not-needed")
    from openai import AzureOpenAI

    return AzureOpenAI(
        azure_endpoint=config.AZURE_OPENAI_ENDPOINT,
        api_key=config.AZURE_OPENAI_KEY,
        api_version=config.AZURE_OPENAI_API_VERSION,
    )


_EXTRACT_TOOL = {
    "type": "function",
    "function": {
        "name": "invoice_fields",
        "description": "Structured fields read verbatim from an invoice document.",
        "parameters": {
            "type": "object",
            "properties": {
                "invoice_number": {"type": "string"},
                "vendor_name": {"type": "string"},
                "amount": {"type": "number", "description": "net amount before tax"},
                "tax_amount": {"type": "number", "description": "GST / total tax"},
                "invoice_date": {"type": "string", "description": "YYYY-MM-DD"},
                "due_date": {"type": "string", "description": "YYYY-MM-DD"},
                "department": {"type": "string"},
            },
        },
    },
}


def extract_invoice_fields(text: str) -> dict[str, dict] | None:
    """LLM structured read of an invoice's text layer. Returns the {value,
    confidence} field contract, or None (OFFLINE / empty / model declined) to
    tell the caller to fall back to the offline regex."""
    from .ocr import shape_llm_fields

    if config.OFFLINE or not text.strip():
        return None
    resp = _client().chat.completions.create(
        model=config.MODEL,
        messages=[
            {"role": "system", "content": "Extract invoice fields from the document text. "
             "Use only what is present; omit any field you cannot read. Dates as YYYY-MM-DD."},
            {"role": "user", "content": text[:12000]},
        ],
        tools=[_EXTRACT_TOOL],
        tool_choice={"type": "function", "function": {"name": "invoice_fields"}},
        temperature=0,
    )
    calls = resp.choices[0].message.tool_calls or []
    return shape_llm_fields(calls[0].function.arguments) if calls else None


def plan_query(question: str) -> dict | None:
    """LLM decides which whitelisted query answers the question. Returns tool args
    dict, or None — either OFFLINE, or the model declined (greeting / off-topic /
    not about invoices), which the caller must treat differently from OFFLINE."""
    if config.OFFLINE:
        return None
    from datetime import date

    resp = _client().chat.completions.create(
        model=config.MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    f"Today's date is {date.today().isoformat()}. If the question is about "
                    "invoices, vendors, customers, payments, or predictions, call query_invoices "
                    "with the best filter. If it's a greeting or unrelated to that data "
                    "(e.g. 'hi', 'thanks', small talk), do not call the function."
                ),
            },
            {"role": "user", "content": question},
        ],
        tools=[_SUMMARISE_TOOL],
        tool_choice="auto",
        temperature=0,
    )
    calls = resp.choices[0].message.tool_calls or []
    return None if not calls else __import__("json").loads(calls[0].function.arguments)


def summarise(question: str, rows: list[dict], what: str) -> str:
    if config.OFFLINE or not rows:
        return _offline_summary(question, rows, what)
    resp = _client().chat.completions.create(
        model=config.MODEL,
        messages=[
            {"role": "system", "content": "Summarise the rows in 2-4 plain sentences for a finance user. Use the numbers given; do not invent. All amounts are in Indian Rupees — write them with the ₹ symbol, never $."},
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
        model=config.MODEL,
        messages=[
            {"role": "system", "content": "Explain, in plain language, why this invoice was flagged as a likely duplicate. Use ONLY the facts provided. Do not re-derive or assert a new match."},
            {"role": "user", "content": facts},
        ],
        temperature=0.2,
    )
    return resp.choices[0].message.content.strip()


def _invoice_facts(inv: dict) -> str:
    party = inv.get("vendor") or inv.get("customer") or {}
    party_label = "vendor" if inv.get("vendor") else "customer"
    items = inv.get("lineItems") or []
    items_txt = (
        "; ".join(f"{x.get('description', '')} x{x.get('quantity', '')}" for x in items if x.get("description"))
        or "none listed"
    )
    facts = (
        f"Invoice {inv.get('invoice_number', '')} ({inv.get('direction', 'payable')}), "
        f"{party_label} {party.get('name', 'unknown')}, department {inv.get('department', '')}, "
        f"₹{float(inv.get('amount') or 0):,.0f} + ₹{float(inv.get('tax_amount') or 0):,.0f} tax, "
        f"invoiced {inv.get('invoice_date', '')}, due {inv.get('due_date', '')}, "
        f"status {inv.get('approval_status', '')}/{inv.get('payment_status', '')}. "
        f"Line items: {items_txt}."
    )
    extracted = (inv.get("extracted_text") or "").strip()
    if extracted:
        # The invoice's own OCR'd document text — what it's actually *for*
        # (product/service descriptions, terms, notes) lives here, not in the
        # structured columns above. Capped like extract_invoice_fields()'s
        # own LLM call, same reasoning: bound the prompt, not the document.
        facts += f"\n\nDocument text:\n{extracted[:12000]}"
    return facts


def summarise_invoice(inv: dict) -> str:
    """1-2 plain sentences on what this invoice is for — shown on the invoice
    detail page when it has no manually-entered description."""
    facts = _invoice_facts(inv)
    if config.OFFLINE:
        party = inv.get("vendor") or inv.get("customer") or {}
        verb = "owed to" if inv.get("direction") == "receivable" else "billed by"
        return (
            f"₹{float(inv.get('amount') or 0) + float(inv.get('tax_amount') or 0):,.0f} "
            f"{verb} {party.get('name', 'unknown')} for {inv.get('department', 'this department')}, "
            f"due {inv.get('due_date', 'unknown date')}."
        )
    resp = _client().chat.completions.create(
        model=config.MODEL,
        messages=[
            {"role": "system", "content": "Write 2-4 plain sentences for a finance user summarising "
             "what this invoice is for and the amount. If a 'Document text' section is given, that is "
             "the invoice's own OCR'd text — base what the invoice is actually for on it (products/"
             "services, terms, notable line items or notes), not on the department field. Only fall "
             "back to inferring from department/line items when no document text is given, and don't "
             "invent a product/service if line items say 'none listed' and there's no document text. "
             "Amounts are in Indian Rupees — use ₹, not $."},
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


# ---- hybrid RAG: route classification + answer synthesis --------------------

def classify_route(question: str) -> str:
    """Ambiguous question -> 'structured' | 'semantic' | 'both'. Biased to
    'structured' (a wrong structured query is easy to catch; a wrong semantic
    guess presented as fact is not). OFFLINE -> always 'structured'."""
    if config.OFFLINE:
        return "structured"
    try:
        resp = _client().chat.completions.create(
            model=config.MODEL,
            messages=[
                {"role": "system", "content": "Reply with exactly one word: structured, semantic, or both. "
                 "'structured' = totals, counts, filters, aggregations (exact answers from a database). "
                 "'semantic' = free-text similarity, 'invoices that mention X', 'similar to this one'. "
                 "'both' = needs a computed figure AND a similarity match. When unsure, reply structured."},
                {"role": "user", "content": question},
            ],
            temperature=0,
        )
        out = (resp.choices[0].message.content or "").strip().lower()
        return out if out in ("structured", "semantic", "both") else "structured"
    except Exception:
        return "structured"


def synthesize(question: str, structured: dict | None, semantic: list[dict] | None) -> str:
    """Merge the structured rows and the semantic matches into one answer."""
    if not structured and not semantic:
        return "No matching invoices."
    if config.OFFLINE:
        return _offline_synthesis(question, structured, semantic)
    parts: list[str] = []
    if structured:
        parts.append(f"Structured result ({structured['what']}, {len(structured['rows'])} rows):\n{structured['rows'][:25]}")
    if semantic:
        parts.append("Semantically similar invoices:\n"
                     + "\n".join(f"- {r['chunk_text']} (score {float(r['similarity']):.2f})" for r in semantic))
    resp = _client().chat.completions.create(
        model=config.MODEL,
        messages=[
            {"role": "system", "content": "Answer the finance user using ONLY the data provided. Cite invoice "
             "numbers. If a structured total and the semantic matches disagree, trust the structured total. "
             "2–5 plain sentences; do not invent figures. All amounts are in Indian Rupees — write them with "
             "the ₹ symbol, never $."},
            {"role": "user", "content": f"Question: {question}\n\n" + "\n\n".join(parts)},
        ],
        temperature=0.2,
    )
    return resp.choices[0].message.content.strip()


def _offline_synthesis(question: str, structured: dict | None, semantic: list[dict] | None) -> str:
    out: list[str] = []
    if structured:
        out.append(_offline_summary(question, structured["rows"], structured["what"]))
    if semantic:
        names = [r["chunk_text"].split("\n", 1)[0].replace("Invoice ", "").strip() for r in semantic[:5]]
        out.append("Most similar: " + ", ".join(names) + ".")
    return " ".join(out) if out else "No matching invoices."
