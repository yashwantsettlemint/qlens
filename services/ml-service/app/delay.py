"""Delay prediction. Uses models/delay_model.pkl when present (see ml/train.py);
otherwise a transparent heuristic so /score works before a model is trained.
"""

from __future__ import annotations

import pickle
from datetime import date
from functools import lru_cache

from .config import MODEL_PATH
from .features import assemble_features, vendor_ontime_rate

HEURISTIC_VERSION = "heuristic-v0"


@lru_cache(maxsize=1)
def _load_model():
    if not MODEL_PATH.exists():
        return None
    with open(MODEL_PATH, "rb") as fh:
        return pickle.load(fh)  # {"clf","reg","feature_names","version",...}


def predict_from_features(feats: dict[str, float]) -> dict:
    model = _load_model()
    if model is None:
        rate = feats["vendor_ontime_rate"]
        prob = 0.12 + 0.55 * (1 - rate) + 0.12 * (1 - feats["po_matched"])
        prob += 0.08 if feats["day_of_month"] >= 25 else 0.0
        prob = round(max(0.02, min(0.95, prob)), 4)
        return {
            "delay_probability": prob,
            "predicted_delay_days": int(round(prob * 25)),
            "model_version": HEURISTIC_VERSION,
        }

    import numpy as np

    x = np.array([[feats.get(n, 0.0) for n in model["feature_names"]]], dtype=float)
    prob = float(model["clf"].predict_proba(x)[0, 1])
    days = int(max(0, round(float(model["reg"].predict(x)[0]))))
    return {
        "delay_probability": round(prob, 4),
        "predicted_delay_days": days,
        "model_version": model["version"],
    }


def predict_delay(invoice: dict, vendor_paid_history: list[dict]) -> dict:
    """`invoice` keys: amount, tax_amount, department, invoice_date, po_id,
    approval_chain_length (optional)."""
    inv_date = date.fromisoformat(str(invoice["invoice_date"])[:10])
    feats = assemble_features(
        vendor_ontime_rate=vendor_ontime_rate(vendor_paid_history),
        amount=float(invoice["amount"]),
        department=str(invoice.get("department") or ""),
        approval_chain_length=int(invoice.get("approval_chain_length") or 0),
        invoice_day_of_month=inv_date.day,
        tax_amount=float(invoice.get("tax_amount") or 0),
        po_matched=bool(invoice.get("po_id")),
    )
    return predict_from_features(feats)
