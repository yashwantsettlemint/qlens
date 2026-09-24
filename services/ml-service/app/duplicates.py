"""Duplicate detection — XGBoost only (models/duplicate_model.pkl, see
ml/train_duplicates.py): a classifier over pairwise features. No model on disk,
or an unloadable one -> the error propagates. There is no rule-based fallback.

`detect()` is the seam: both callers (/score, /check-duplicate) get a
DuplicateMatch with method="ml", and don't care how it was produced.
"""

from __future__ import annotations

import pickle
from dataclasses import dataclass
from functools import lru_cache

from . import ModelUnavailable
from .config import DUPLICATE_MODEL_PATH, company_model_path
from .dup_features import pair_features
from .explain import feature_contributions


MAX_DAY_GAP = 60


@dataclass
class DuplicateMatch:
    matched_invoice_id: str
    confidence_score: float
    method: str
    reason: str
    explanation: list[dict]


@lru_cache(maxsize=64)  # bounded: many companies' models shouldn't live in memory forever
def _load_model(company_id: str):
    path = company_model_path(company_id, DUPLICATE_MODEL_PATH)
    source = "trained"
    if not path.exists():
        path, source = DUPLICATE_MODEL_PATH, "bootstrap"  # shared synthetic model
    if not path.exists():
        raise ModelUnavailable(
            f"duplicate model not found at {path} - run `python -m ml.train_duplicates`"
        )
    with open(path, "rb") as fh:
        model = pickle.load(fh)  # {"clf","feature_names","version","threshold"}
    model["source"] = source
    return model


def _detect_ml(candidate: dict, existing: list[dict], model) -> DuplicateMatch | None:
    import numpy as np

    names = model["feature_names"]
    threshold = float(model.get("threshold", 0.5))
    rows, feats_list = [], []
    for other in existing:
        if other.get("id") and other["id"] == candidate.get("id"):
            continue
        f = pair_features(candidate, other)
        # A re-entered invoice lands days apart, not months — the synthetic
        # training positives top out at 45 days. Same party + similar amount
        # half a year apart is just a recurring bill, whatever the model says.
        if f["day_gap"] > MAX_DAY_GAP:
            continue
        # Strict gate: same party (by caller) and every field identical.
        if not (
            f["day_gap"] == 0 and f["amount_exact"] and f["tax_rel_gap"] == 0
            and f["num_exact"] and f["dept_match"]
            and (not f["both_have_po"] or f["same_po"])
        ):
            continue
        feats_list.append(f)
        rows.append(other)
    if not rows:
        return None

    x = np.array([[f.get(n, 0.0) for n in names] for f in feats_list], dtype=float)
    probs = model["clf"].predict_proba(x)[:, 1]
    i = int(probs.argmax())
    p = float(probs[i])
    if p < threshold:
        return None
    f = feats_list[i]
    bits = [f"model {p:.0%} confident"]
    if f["amount_exact"]:
        bits.append("exact amount")
    elif f["amount_rel_gap"] < 0.02:
        bits.append("amount within 2%")
    if f["same_po"]:
        bits.append("same PO")
    elif f["num_ratio"] >= 0.85 or f["num_partial"] >= 0.9:
        bits.append(f"invoice # {f['num_ratio'] * 100:.0f}% similar")
    bits.append(f"{int(f['day_gap'])}d apart")
    x_row = np.array([[f.get(n, 0.0) for n in names]], dtype=float)
    explanation = feature_contributions(model["clf"], x_row, names)
    return DuplicateMatch(
        matched_invoice_id=rows[i]["id"],
        confidence_score=round(max(0.0, min(1.0, p)), 4),
        method="ml",
        reason="; ".join(bits),
        explanation=explanation,
    )


def model_info(company_id: str) -> dict:
    """Technical details of the trained duplicate model, for an admin status view."""
    try:
        model = _load_model(company_id)
    except ModelUnavailable:
        return {"status": "not_trained", "method": "rule_based", "model_version": "rule_based-v0"}
    return {
        "status": "trained",
        "source": model.get("source", "trained"),
        "method": "ml",
        "model_version": model.get("version"),
        "trained_at": model.get("trained_at"),
        "n_rows": model.get("n_rows"),
        "feature_count": len(model.get("feature_names", [])),
        "threshold": model.get("threshold"),
        "metrics": model.get("metrics", {}),
    }


def detect(candidate: dict, existing: list[dict], company_id: str) -> DuplicateMatch | None:
    """`candidate` and `existing` rows use keys: id, invoice_number, amount,
    tax_amount, po_id, invoice_date, department. `existing` is the same party's
    other invoices — the vendor's for a payable, the customer's for a receivable.

    Raises ModelUnavailable if the trained model is missing, or the underlying
    error if the pickle is unloadable — no fallback.
    """
    return _detect_ml(candidate, existing, _load_model(company_id))
