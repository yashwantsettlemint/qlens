"""Invoice-field extraction from an uploaded document.

PDFs with a text layer -> pull the text, hand it to the LLM (or the offline
regex below) for structured fields. Scanned / image PDFs and non-PDF uploads
have no text layer and need a real OCR / vision provider (Azure Document
Intelligence, a vision model) which is not wired here -> the caller returns an
empty pending-review skeleton.

ponytail: text-layer PDFs only. For image OCR, plug a provider into main.py's
/extract-ocr fallback branch; the field contract here stays the same.
"""

from __future__ import annotations

import io
import json
import re

FIELDS = (
    "invoice_number",
    "vendor_name",
    "amount",
    "tax_amount",
    "invoice_date",
    "due_date",
    "department",
)


def pdf_text(raw: bytes) -> str:
    """Best-effort text-layer extraction. '' if pypdf is missing or the file has no text."""
    try:
        from pypdf import PdfReader
    except ModuleNotFoundError:
        return ""
    try:
        reader = PdfReader(io.BytesIO(raw))
        return "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    except Exception:
        return ""


_DATE = r"(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})"
_MONEY = r"([0-9][0-9,]*\.?\d{0,2})"


def regex_fields(text: str) -> dict[str, dict]:
    """Deterministic best-effort — used when the LLM is offline or declines."""

    def find(pat: str) -> str | None:
        m = re.search(pat, text, re.I)
        return m.group(1).strip() if m else None

    guesses = {
        "invoice_number": find(r"invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9/\-]+)"),
        "vendor_name": find(r"(?:vendor|supplier|bill\s*from|sold\s*by)\s*[:\-]?\s*(.+)"),
        "amount": find(
            rf"(?:grand\s*total|total\s*(?:amount|due|payable)?)\s*[:\-]?\s*(?:₹|inr|rs\.?)?\s*{_MONEY}"
        ),
        "tax_amount": find(
            rf"(?:gst|tax|vat|igst|total\s*tax)\s*(?:amount)?\s*[:\-]?\s*(?:₹|inr|rs\.?)?\s*{_MONEY}"
        ),
        "invoice_date": find(rf"invoice\s*date\s*[:\-]?\s*{_DATE}"),
        "due_date": find(rf"(?:due\s*date|payment\s*due)\s*[:\-]?\s*{_DATE}"),
        "department": find(r"department\s*[:\-]?\s*([A-Za-z &]+)"),
    }
    return {
        k: {"value": _coerce(k, v), "confidence": 0.35 if v else 0.0}
        for k, v in guesses.items()
    }


def _coerce(field: str, v: str | None):
    if v is None:
        return None
    v = v.strip().strip(".,;")
    if field in ("amount", "tax_amount"):
        try:
            return float(v.replace(",", ""))
        except ValueError:
            return None
    return v or None


def empty_fields() -> dict[str, dict]:
    return {f: {"value": None, "confidence": 0.0} for f in FIELDS}


def shape_llm_fields(got: dict) -> dict[str, dict]:
    """Map the LLM tool-call args onto the {value, confidence} field contract."""
    if isinstance(got, str):
        got = json.loads(got)
    return {
        f: {
            "value": _coerce(f, got.get(f)) if isinstance(got.get(f), str) else got.get(f),
            "confidence": 0.75 if got.get(f) not in (None, "") else 0.0,
        }
        for f in FIELDS
    }
