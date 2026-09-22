"""Chunking for embeddings.

One short structured-summary chunk (invoice number, party, amounts, dates,
status, line items) — invoices are short structured records; splitting that
mid-record destroys meaning. Plus, when the invoice has a long extracted
document (multi-page OCR text — a scanned invoice can run 7-10+ pages),
one chunk per overlapping word-window of that text: a single vector for a
multi-page document would either get silently truncated by the embedding
model's token limit (all-MiniLM-L6-v2 caps at ~256 tokens) or wash out
everything but the first page's content once truncated. Splitting means the
later pages are still actually searchable.
"""

from __future__ import annotations

# ~180 words safely undercuts the embedding model's ~256-token limit (a word
# is rarely more than ~1.3 tokens); 30-word overlap keeps a sentence that
# straddles a window boundary findable from either side.
_WINDOW_WORDS = 180
_OVERLAP_WORDS = 30


def _line_items(inv: dict) -> str:
    items = inv.get("lineItems") or inv.get("line_items") or []
    parts = []
    for x in items:
        desc = x.get("description") or ""
        qty = x.get("quantity", "")
        price = x.get("unit_price", x.get("unitPrice", ""))
        parts.append(f"{desc} x{qty} @ {price}".strip())
    return "; ".join(p for p in parts if p) or "none listed"


def _summary_chunk(inv: dict) -> str:
    party = (
        (inv.get("vendor") or {}).get("name")
        or (inv.get("customer") or {}).get("name")
        or inv.get("vendor_name")
        or "unknown party"
    )
    parts = [
        f"Invoice {inv.get('invoice_number', '')} from {party}",
        f"Amount: {inv.get('amount', '')} (tax: {inv.get('tax_amount', '')})",
        f"Department: {inv.get('department', '')}",
        f"Dates: invoiced {inv.get('invoice_date', '')}, due {inv.get('due_date', '')}",
        f"Status: {inv.get('approval_status', '')}, {inv.get('payment_status', '')}",
        f"Line items: {_line_items(inv)}",
    ]
    description = inv.get("description")
    if description:
        parts.append(f"Description: {description}")
    return "\n".join(parts)


def _windows(text: str, window_words: int = _WINDOW_WORDS, overlap_words: int = _OVERLAP_WORDS) -> list[str]:
    words = text.split()
    if len(words) <= window_words:
        return [text] if words else []
    step = window_words - overlap_words
    return [" ".join(words[i : i + window_words]) for i in range(0, len(words), step) if words[i : i + window_words]]


def invoice_to_chunks(inv: dict) -> list[str]:
    """`inv` may use camelCase (`lineItems`, nested `vendor{name}`) or snake_case
    (`line_items`, `vendor_name`) — both from Hasura, one from the mock.

    First chunk is always the structured summary. When the invoice came from
    an uploaded document (`extracted_text`/`extractedText` — the raw OCR
    text, which can span many pages), that text is split into overlapping
    word-windows, each its own chunk, so a semantic search can match on
    wording that never made it into a column (payment terms, a clause, a PO
    reference mentioned in prose, etc) *anywhere* in the document, not just
    on whatever fit in the first ~256 tokens.
    """
    chunks = [_summary_chunk(inv)]
    extracted_text = inv.get("extracted_text") or inv.get("extractedText")
    if extracted_text:
        chunks.extend(f"Extracted document text (part {i + 1}):\n{w}" for i, w in enumerate(_windows(extracted_text)))
    return chunks
