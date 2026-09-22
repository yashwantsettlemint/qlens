"""Payable-vs-receivable guess: is *our* company the buyer or the seller on
this document? Compares the OCR/LLM-read vendor_name and buyer_name against
the company name + aliases set in Admin -> Company Settings.

Fuzzy, not exact: OCR noise and "Pvt Ltd" vs "Private Limited" style variants
mean a plain string == would miss most real invoices.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

_SUFFIX_RE = re.compile(
    r"\b(pvt|p\.?v\.?t|private|ltd|limited|inc|incorporated|llp|llc|corp|corporation|co)\b\.?",
    re.I,
)
_PUNCT_RE = re.compile(r"[^a-z0-9 ]")

MATCH_THRESHOLD = 0.75  # SequenceMatcher ratio on normalized names — 0.82 missed a
# real company name that was configured as a short-form ("settlemint india" vs.
# the invoice's "Settlemint India Services Private Limited", 0.78); the loose
# suffix-stripping in _normalize() already guards against a too-permissive match.


def _normalize(name: str) -> str:
    s = _PUNCT_RE.sub(" ", (name or "").lower())
    s = _SUFFIX_RE.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def _best_match(name: str | None, candidates: list[str]) -> float:
    """Best similarity ratio of `name` against any candidate, 0.0 if either side
    is empty."""
    norm = _normalize(name or "")
    if not norm:
        return 0.0
    best = 0.0
    for c in candidates:
        cn = _normalize(c)
        if not cn:
            continue
        best = max(best, SequenceMatcher(None, norm, cn).ratio())
    return best


def infer_direction(vendor_name: str | None, buyer_name: str | None, company: dict | None) -> dict:
    """-> {direction, counterparty_name, matched_as} | {direction: None, ...} when
    company settings aren't configured yet or neither side confidently matches."""
    names = [n for n in [(company or {}).get("name"), *((company or {}).get("aliases") or [])] if n]
    if not names:
        return {"direction": None, "counterparty_name": None, "matched_as": None}

    vendor_score = _best_match(vendor_name, names)
    buyer_score = _best_match(buyer_name, names)

    if vendor_score < MATCH_THRESHOLD and buyer_score < MATCH_THRESHOLD:
        return {"direction": None, "counterparty_name": None, "matched_as": None}

    # we're the seller (vendor) -> money is coming in -> receivable, counterparty is the buyer
    if vendor_score >= buyer_score:
        return {"direction": "receivable", "counterparty_name": buyer_name, "matched_as": "vendor_name"}
    # we're the buyer -> money is going out -> payable, counterparty is the vendor
    return {"direction": "payable", "counterparty_name": vendor_name, "matched_as": "buyer_name"}
