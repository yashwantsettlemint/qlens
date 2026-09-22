"""Page-level source detection.

For PDFs, decide *per page* whether it has a real, usable text layer — some
scanners embed a low-quality invisible OCR layer that a naive `len(text) > 0`
check would wrongly treat as digital, so we also run a garbled-text heuristic.
"""

from __future__ import annotations

import re

from .config import MIN_TEXT_CHARS

# A "clean" word for invoice text: letters/digits plus the punctuation that
# legitimately appears in vendor names, invoice numbers, money and dates.
# (The spec's original `^[A-Za-z0-9.,/\-]+$` rejects "R&D", "Vendor's",
# "₹1,200", "(GST)" — real words — and would over-flag digital invoices.)
_CLEAN_WORD = re.compile(r"^[A-Za-z0-9.,:;/#&()'\"%+*\-₹$£€@]+$")


def is_real_text(text: str) -> bool:
    t = (text or "").strip()
    if len(t) < MIN_TEXT_CHARS:
        return False
    words = t.split()
    if not words:
        return False
    alpha_ratio = sum(c.isalpha() for c in t) / len(t)
    avg_word_len = sum(len(w) for w in words) / len(words)
    gibberish_ratio = sum(1 for w in words if not _CLEAN_WORD.match(w)) / len(words)
    printable_ratio = sum(1 for c in t if c.isprintable() or c.isspace()) / len(t)
    return (
        alpha_ratio > 0.5
        and avg_word_len > 2
        and gibberish_ratio < 0.3
        and printable_ratio > 0.95
    )


def route_pages(pdf_bytes: bytes, max_pages: int) -> list[dict]:
    """[{page_num, method: 'direct'|'ocr', direct_text}] — decided per page."""
    import fitz  # PyMuPDF

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    routed: list[dict] = []
    for i, page in enumerate(doc):
        if i >= max_pages:
            break
        text = page.get_text() or ""
        real = is_real_text(text)
        routed.append(
            {
                "page_num": i,
                "method": "direct" if real else "ocr",
                "direct_text": text if real else None,
            }
        )
    doc.close()
    return routed


def is_pdf(raw: bytes, content_type: str | None) -> bool:
    if content_type and "pdf" in content_type.lower():
        return True
    return raw[:5] == b"%PDF-"
