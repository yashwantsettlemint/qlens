"""Rule-based duplicate detection. `detect()` is the seam — swap in an ML
classifier later by returning a DuplicateMatch with method="ml"; the callers
(/score, /check-duplicate) don't change.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from rapidfuzz import fuzz

from .config import (
    DUPLICATE_AMOUNT_TOLERANCE,
    DUPLICATE_DAY_WINDOW,
    DUPLICATE_FUZZY_THRESHOLD,
)


@dataclass
class DuplicateMatch:
    matched_invoice_id: str
    confidence_score: float
    method: str
    reason: str


def _day(value) -> date:
    return date.fromisoformat(str(value)[:10])


def detect(candidate: dict, existing: list[dict]) -> DuplicateMatch | None:
    """`candidate` and `existing` rows use keys: id, vendor_id, invoice_number,
    amount, po_id, invoice_date. `existing` is the same vendor's other invoices."""
    amount = float(candidate["amount"])
    cand_no = str(candidate.get("invoice_number") or "")
    cand_po = candidate.get("po_id")
    cand_date = _day(candidate["invoice_date"])

    best: DuplicateMatch | None = None
    for other in existing:
        if other.get("id") and other["id"] == candidate.get("id"):
            continue
        other_amt = float(other["amount"])
        amount_gap = abs(amount - other_amt) / max(amount, other_amt, 1.0)
        if amount_gap > DUPLICATE_AMOUNT_TOLERANCE:
            continue

        day_gap = abs((cand_date - _day(other["invoice_date"])).days)
        if day_gap > DUPLICATE_DAY_WINDOW:
            continue

        num_score = fuzz.ratio(cand_no, str(other.get("invoice_number") or ""))
        same_po = bool(cand_po) and cand_po == other.get("po_id")
        if num_score < DUPLICATE_FUZZY_THRESHOLD and not same_po:
            continue

        confidence = round(
            0.5 * (1 - amount_gap / DUPLICATE_AMOUNT_TOLERANCE)
            + 0.3 * (num_score / 100.0)
            + 0.2 * (1 - day_gap / DUPLICATE_DAY_WINDOW),
            4,
        )
        confidence = max(0.0, min(1.0, confidence))
        reason_bits = [f"amount within {DUPLICATE_AMOUNT_TOLERANCE:.0%}", f"{day_gap}d apart"]
        reason_bits.append("same PO" if same_po else f"invoice # {num_score:.0f}% similar")
        match = DuplicateMatch(
            matched_invoice_id=other["id"],
            confidence_score=confidence,
            method="rule_based",
            reason="; ".join(reason_bits),
        )
        if best is None or match.confidence_score > best.confidence_score:
            best = match
    return best
