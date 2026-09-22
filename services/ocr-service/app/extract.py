"""Combine routed pages into one document, extract fields, and tag each field
with a confidence.

Confidence capping: an OCR-sourced field can't be more reliable than the text it
was read from. We merge all pages into one blob and don't track which page each
field came from, so we cap conservatively — at the *minimum* OCR page confidence
whenever any page was OCR'd.  ponytail: per-field page attribution would tighten
this; not worth it until field-level provenance is actually needed.
"""

from __future__ import annotations

import re

from . import llm

FIELDS = ("vendor_name", "buyer_name", "invoice_number", "invoice_date", "due_date", "amount", "tax_amount")

_MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split()

_DATE_PATTERNS = (
    (re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b"), "ymd"),
    (re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b"), "dmy"),
    (re.compile(r"\b(\d{1,2})[ .\-]([A-Za-z]{3,9})\.?[ .\-,]+(\d{4})\b"), "dMy"),
    (re.compile(r"\b([A-Za-z]{3,9})\.?[ .\-]+(\d{1,2}),?[ .\-]+(\d{4})\b"), "Mdy"),
)

# money like 1,23,456.78 / 24,990.00 / 29488.20 — needs a grouping comma or 2dp
_MONEY_RE = re.compile(r"(?<![\d.,])(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{2})(?![\d])")

_COMPANY_HINT = re.compile(
    r"\b(pvt|p\.?v\.?t|ltd|limited|inc|llp|llc|corp|company|co\b|&|technologies|industries"
    r"|enterprises|solutions|services|systems|traders|associates|international)\b",
    re.I,
)


def _norm_date(s: str) -> str | None:
    for rx, kind in _DATE_PATTERNS:
        m = rx.search(s or "")
        if not m:
            continue
        try:
            if kind == "ymd":
                y, mo, d = m.group(1), m.group(2), m.group(3)
            elif kind == "dmy":
                d, mo, y = m.group(1), m.group(2), m.group(3)
                if len(y) == 2:
                    y = "20" + y
            elif kind == "dMy":
                d, y = m.group(1), m.group(3)
                mo = _MONTHS.index(m.group(2)[:3].lower()) + 1
            else:  # Mdy
                d, y = m.group(2), m.group(3)
                mo = _MONTHS.index(m.group(1)[:3].lower()) + 1
            iso = f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
            return iso if 1 <= int(mo) <= 12 and 1 <= int(d) <= 31 else None
        except (ValueError, IndexError):
            continue
    return None


def _money(s: str) -> float | None:
    m = _MONEY_RE.search(s or "")
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


def combine_pages(routed: list[dict], ocr_results: dict[int, dict]) -> dict:
    full: list[str] = []
    source_map: list[dict] = []
    for p in routed:
        if p["method"] == "direct":
            full.append(p.get("direct_text") or "")
            source_map.append({"page": p["page_num"], "method": "direct", "confidence": 1.0})
        else:
            o = ocr_results.get(p["page_num"], {})
            full.append(o.get("text", "") or "")
            source_map.append(
                {
                    "page": p["page_num"],
                    "method": "ocr",
                    "confidence": round(float(o.get("avg_confidence") or 0.0), 4),
                }
            )
    return {"full_text": "\n".join(full).strip(), "source_map": source_map}


def _num(s):
    if s is None:
        return None
    try:
        return float(str(s).replace(",", "").replace("₹", "").strip())
    except ValueError:
        return None


def _invoice_id(s: str) -> str | None:
    """An invoice-number-shaped token: has a digit, len >= 5, not a GSTIN/PAN line,
    not pure digits/punctuation (dates, pin codes, phone numbers)."""
    if re.search(r"gstin|gst\s*no|pan\b|hsn|sac\b|ifsc|a/?c\s*no", s or "", re.I):
        return None
    for tok in re.findall(r"[A-Za-z0-9][A-Za-z0-9/_.\-]{4,}", s or ""):
        if not any(c.isdigit() for c in tok):
            continue
        if re.fullmatch(r"[\d,./\-]+", tok):  # a date / number, not an id
            continue
        if re.fullmatch(r"\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]{2}", tok):  # GSTIN
            continue
        return tok.strip(".,-")
    return None


def extract_fields_regex(text: str) -> dict:
    """Layout-tolerant best-effort. OCR of a real invoice interleaves multi-column
    headers and puts labels and values on different lines, so: find a label
    anywhere, then scan the next few lines for a value of the right shape. This is
    a fallback — the LLM path (AZURE_OPENAI_*) handles arbitrary layouts far better.
    """
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    low = [ln.lower() for ln in lines]

    def after_label(label_rx: re.Pattern, value_fn, window: int = 6):
        for i, ln in enumerate(lines):
            m = label_rx.search(ln)
            if not m:
                continue
            got = value_fn(ln[m.end():])  # value trailing the label on the same line
            if got:
                return got
            for j in range(i + 1, min(i + 1 + window, len(lines))):  # ...or just below
                got = value_fn(lines[j])
                if got:
                    return got
        return None

    invoice_number = after_label(
        re.compile(r"invoice\s*(?:no\.?|number|num|#|ref)", re.I), _invoice_id
    )
    invoice_date = after_label(
        re.compile(r"invoice\s*date|date\s*of\s*invoice|bill(?:ing)?\s*date", re.I), _norm_date
    ) or after_label(re.compile(r"\bdate\b(?!\s*of\s*supply)", re.I), _norm_date)
    due_date = after_label(
        re.compile(r"due\s*date|payment\s*due|pay(?:able)?\s*by", re.I), _norm_date
    )

    # vendor: labelled if possible; else the first company-looking line above the
    # BILL TO / SHIP TO / customer block (that block is the *buyer*).
    vendor_name = after_label(
        re.compile(r"vendor|supplier|sold\s*by|seller|bill\s*from|from\s*:", re.I),
        lambda s: s.strip(" :-.") or None,
        window=2,
    )
    if not vendor_name:
        stop = next(
            (i for i, ln in enumerate(low)
             if re.search(r"bill\s*to|ship\s*to|sold\s*to|buyer|customer|invoice\s*(no|number|#)", ln)),
            len(lines),
        )
        for ln in lines[: max(stop, 1)]:
            if _COMPANY_HINT.search(ln) and not re.search(r"invoice|gstin|tax\s*invoice|statement", ln, re.I):
                vendor_name = ln.strip(" .:-")
                break

    # buyer: the company-looking line under BILL TO / SHIP TO / SOLD TO — the
    # mirror of the vendor lookup above. Used to tell payable from receivable
    # (see match.py): whichever of vendor/buyer is *our* company decides it.
    buyer_name = after_label(
        re.compile(r"bill\s*to|ship\s*to|sold\s*to|buyer\s*:|customer\s*:", re.I),
        lambda s: s.strip(" :-.") if _COMPANY_HINT.search(s) or len(s.strip()) > 3 else None,
        window=3,
    )

    # grand total: prefer explicit "total due / grand total / amount payable"
    # phrasing over "subtotal"; take the largest money on/near that line.
    total = None
    for i, ln in enumerate(low):
        if re.search(
            r"\b(grand\s*total|total\s*due|total\s*payable|amount\s*payable|balance\s*due"
            r"|amount\s*due|net\s*payable|total\s*amount)\b",
            ln,
        ):
            near = [_money(lines[k]) for k in range(i, min(i + 3, len(lines)))]
            near = [c for c in near if c]
            if near:
                total = max(near)
                break
    if total is None:
        all_money = [m for m in (_money(ln) for ln in lines) if m]
        total = max(all_money) if all_money else None

    # tax: sum the CGST/SGST/IGST components (each label and its amount may be on
    # separate OCR lines), else a single GST/Tax/VAT line. `seen` stops the SGST
    # scan from re-counting the CGST amount.
    comp_rx = re.compile(r"\b(cgst|sgst|igst|utgst)\b", re.I)
    seen: set[int] = set()
    components: list[float] = []
    for i, ln in enumerate(lines):
        if not comp_rx.search(ln):
            continue
        for j in range(i, min(i + 3, len(lines))):
            v = _money(lines[j])
            if v is not None and j not in seen:
                components.append(v)
                seen.add(j)
                break
    tax_amount = (
        round(sum(components), 2)
        if components
        else after_label(re.compile(r"\b(gst|tax|vat)\b\s*(?:amount|total)?", re.I), _money)
    )

    return {
        "vendor_name": vendor_name,
        "buyer_name": buyer_name,
        "invoice_number": invoice_number,
        "invoice_date": invoice_date,
        "due_date": due_date,
        "amount": round(total, 2) if total else None,  # grand total incl. tax — see extract()
        "tax_amount": tax_amount,
        "line_items": [],
    }


def _ocr_confidence_cap(source_map: list[dict]) -> float | None:
    confs = [s["confidence"] for s in source_map if s["method"] == "ocr"]
    return min(confs) if confs else None


def _norm_line_items(raw_items) -> list[dict]:
    out = []
    for it in raw_items or []:
        if not isinstance(it, dict):
            continue
        out.append(
            {
                "description": (it.get("description") or "").strip(),
                "quantity": _num(it.get("quantity")) or 0,
                "unit_price": _num(it.get("unit_price")) or 0.0,
                "line_amount": _num(it.get("line_amount")) or 0.0,
            }
        )
    return out


def extract(full_text: str, source_map: list[dict]) -> dict:
    """-> {<FIELDS>, line_items, field_confidences}."""
    llm_out = None
    try:
        llm_out = llm.extract_fields_llm(full_text)
    except Exception:
        llm_out = None
    used_llm = llm_out is not None
    raw = llm_out if used_llm else extract_fields_regex(full_text)

    cap = _ocr_confidence_cap(source_map)          # None -> fully digital document
    base = 0.97 if used_llm else 0.5               # LLM read vs regex heuristic

    fields: dict = {}
    confs: dict = {}
    for k in FIELDS:
        v = raw.get(k)
        if k in ("amount", "tax_amount"):
            v = _num(v)
        elif isinstance(v, str):
            v = v.strip() or None
        fields[k] = v
        if v in (None, ""):
            confs[k] = 0.0
        else:
            confs[k] = round(min(base, cap) if cap is not None else base, 4)

    # Both extractors (LLM and regex) read `amount` as the grand total incl.
    # tax — that's the one unambiguous number on most invoices. Everything
    # downstream (dashboards/exposure) instead expects amount to be the
    # pre-tax figure and adds tax_amount back on top, so convert once here
    # rather than trusting either extractor to locate/compute a subtotal.
    if fields["amount"] is not None and fields["tax_amount"] is not None:
        fields["amount"] = round(fields["amount"] - fields["tax_amount"], 2)

    return {**fields, "line_items": _norm_line_items(raw.get("line_items")), "field_confidences": confs}
