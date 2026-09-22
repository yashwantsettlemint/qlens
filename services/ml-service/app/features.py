"""Feature engineering for the delay model. `assemble_features` is the single
funnel — both training (ml/train.py) and serving (app/delay.py) build the same
primitives and call it, so there is no train/serve skew.
"""

from __future__ import annotations

import math
from datetime import date

from .config import DEPARTMENTS

FEATURE_NAMES: list[str] = [
    "vendor_ontime_rate",
    "amount_log",
    "approval_chain_length",
    "day_of_month",
    "tax_fraction",
    "po_matched",
    "is_receivable",
    *[f"dept_{d}" for d in DEPARTMENTS],
]


def assemble_features(
    *,
    vendor_ontime_rate: float,
    amount: float,
    department: str,
    approval_chain_length: int,
    invoice_day_of_month: int,
    tax_amount: float,
    po_matched: bool,
    is_receivable: bool = False,
) -> dict[str, float]:
    feats = {
        "vendor_ontime_rate": float(max(0.0, min(1.0, vendor_ontime_rate))),
        "amount_log": math.log1p(max(0.0, float(amount))),
        "approval_chain_length": float(approval_chain_length),
        "day_of_month": float(invoice_day_of_month),
        "tax_fraction": float(tax_amount) / float(amount) if amount else 0.0,
        "po_matched": 1.0 if po_matched else 0.0,
        "is_receivable": 1.0 if is_receivable else 0.0,
    }
    for d in DEPARTMENTS:
        feats[f"dept_{d}"] = 1.0 if department == d else 0.0
    return feats


def vector(feats: dict[str, float]) -> list[float]:
    return [feats.get(name, 0.0) for name in FEATURE_NAMES]


def vendor_ontime_rate(paid_history: list[dict]) -> float:
    """Fraction of a vendor's prior *paid* invoices settled on or before due date.
    `paid_history` rows need `due_date` and `paid_at`. Unknown vendor -> 0.7 prior."""
    settled = [h for h in paid_history if h.get("paid_at") and h.get("due_date")]
    if not settled:
        return 0.7
    on_time = sum(1 for h in settled if _d(h["paid_at"]) <= _d(h["due_date"]))
    return on_time / len(settled)


def _d(value: str) -> date:
    return date.fromisoformat(str(value)[:10])
