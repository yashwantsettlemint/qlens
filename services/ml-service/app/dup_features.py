
from __future__ import annotations

from datetime import date

from rapidfuzz import fuzz

DUP_FEATURE_NAMES: list[str] = [
    "amount_rel_gap",     # |Δamount| / max(amount)   — 0 = identical
    "amount_exact",       # 1 if equal to the paisa
    "tax_rel_gap",        # same, on tax_amount
    "day_gap",            # |Δinvoice_date| in days
    "same_month",         # 1 if same calendar year+month
    "num_ratio",          # rapidfuzz.ratio / 100 on invoice_number
    "num_partial",        # rapidfuzz.partial_ratio / 100 (substring match)
    "num_token_sort",     # rapidfuzz.token_sort_ratio / 100 (reordered tokens)
    "num_len_diff",       # |len difference| of the two invoice numbers
    "num_exact",          # 1 if the invoice numbers are byte-identical (and non-empty)
    "same_po",            # 1 if both have a po_id and they're equal
    "both_have_po",       # 1 if both rows carry a po_id
    "dept_match",         # 1 if both name the same department
]


def _day(value) -> date:
    return date.fromisoformat(str(value)[:10])


def _rel_gap(a: float, b: float) -> float:
    hi = max(abs(a), abs(b), 1.0)
    return abs(a - b) / hi


def pair_features(cand: dict, other: dict) -> dict[str, float]:
    amt_c, amt_o = float(cand["amount"]), float(other["amount"])
    tax_c = float(cand.get("tax_amount") or 0.0)
    tax_o = float(other.get("tax_amount") or 0.0)
    d_c, d_o = _day(cand["invoice_date"]), _day(other["invoice_date"])
    num_c = str(cand.get("invoice_number") or "")
    num_o = str(other.get("invoice_number") or "")
    po_c, po_o = cand.get("po_id"), other.get("po_id")
    dep_c = str(cand.get("department") or "")
    dep_o = str(other.get("department") or "")

    return {
        "amount_rel_gap": _rel_gap(amt_c, amt_o),
        "amount_exact": 1.0 if round(amt_c, 2) == round(amt_o, 2) else 0.0,
        "tax_rel_gap": _rel_gap(tax_c, tax_o),
        "day_gap": float(abs((d_c - d_o).days)),
        "same_month": 1.0 if (d_c.year, d_c.month) == (d_o.year, d_o.month) else 0.0,
        "num_ratio": fuzz.ratio(num_c, num_o) / 100.0,
        "num_partial": fuzz.partial_ratio(num_c, num_o) / 100.0,
        "num_token_sort": fuzz.token_sort_ratio(num_c, num_o) / 100.0,
        "num_len_diff": float(abs(len(num_c) - len(num_o))),
        "num_exact": 1.0 if num_c and num_c == num_o else 0.0,
        "same_po": 1.0 if po_c and po_c == po_o else 0.0,
        "both_have_po": 1.0 if po_c and po_o else 0.0,
        "dept_match": 1.0 if dep_c and dep_c == dep_o else 0.0,
    }


def vector(feats: dict[str, float]) -> list[float]:
    return [feats.get(name, 0.0) for name in DUP_FEATURE_NAMES]
