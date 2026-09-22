"""LLM field extraction — Azure OpenAI tool call, with a regex fallback when
`AZURE_OPENAI_*` is unset (config.OFFLINE) or the call fails. Same field contract
as genai-service's extractor.
"""

from __future__ import annotations

import json

from . import config

_EXTRACT_TOOL = {
    "type": "function",
    "function": {
        "name": "invoice_fields",
        "description": "Structured fields read verbatim from an invoice document.",
        "parameters": {
            "type": "object",
            "properties": {
                "vendor_name": {"type": "string", "description": "the seller / who issued the invoice"},
                "buyer_name": {"type": "string", "description": "the buyer, under Bill To / Ship To / Sold To"},
                "invoice_number": {"type": "string"},
                "invoice_date": {"type": "string", "description": "YYYY-MM-DD"},
                "due_date": {"type": "string", "description": "YYYY-MM-DD"},
                "amount": {"type": "number", "description": "grand total, including tax"},
                "tax_amount": {"type": "number", "description": "GST / total tax"},
                "line_items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "quantity": {"type": "number"},
                            "unit_price": {"type": "number"},
                            "line_amount": {"type": "number"},
                        },
                    },
                },
            },
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


def extract_fields_llm(text: str) -> dict | None:
    """Structured read of the combined document text. Returns the raw tool-call
    dict, or None (OFFLINE / empty / model declined) so the caller falls back to
    the regex extractor."""
    if config.OFFLINE or not text.strip():
        return None
    resp = _client().chat.completions.create(
        model=config.MODEL,
        messages=[
            {
                "role": "system",
                "content": "Extract invoice fields from the document text. Use only what is "
                "present; omit anything you cannot read. Dates as YYYY-MM-DD. `amount` is the "
                "grand total INCLUDING tax. The raw text is column-flattened: two side-by-side "
                "blocks (e.g. FROM / BILL TO) can appear interleaved line-by-line rather than "
                "grouped together. In particular, when two such labels are stacked directly on "
                "top of each other with no value between them (e.g. a line \"FROM\" immediately "
                "followed by a line \"BILL TO\"), the very next line after both labels is the "
                "FROM (vendor) value — read forward from there for the buyer/BILL TO value, "
                "skipping over role or job-title lines (e.g. \"Freelance Service Provider\", "
                "\"Sales Manager\") which are never the vendor_name or buyer_name themselves, "
                "only a description of the person named just above them. vendor_name is who "
                "issued/sent the invoice (FROM, sold by, the signature at the bottom); "
                "buyer_name is who it's billed to (BILL TO, TO, customer). Each is a short "
                "name/company only — never merge multiple lines or roles into one field.",
            },
            {"role": "user", "content": text[:16000]},
        ],
        tools=[_EXTRACT_TOOL],
        tool_choice={"type": "function", "function": {"name": "invoice_fields"}},
        temperature=0,
    )
    calls = resp.choices[0].message.tool_calls or []
    if not calls:
        return None
    args = calls[0].function.arguments
    return json.loads(args) if isinstance(args, str) else args
