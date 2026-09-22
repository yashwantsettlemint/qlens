from __future__ import annotations
import pickle
from datetime import date
from functools import lru_cache
from . import ModelUnavailable
from .config import MODEL_PATH, company_model_path
from .explain import feature_contributions
from .features import assemble_features, vendor_ontime_rate


@lru_cache(maxsize=64)  # bounded: many companies' models shouldn't live in memory forever
def _load_model(company_id: str):
    path = company_model_path(company_id, MODEL_PATH)
    source = "trained"
    if not path.exists():
        path, source = MODEL_PATH, "bootstrap"  # shared synthetic model — no real customer data
    if not path.exists():
        raise ModelUnavailable(
            f"delay model not found at {path} - run `python -m ml.train`"
        )
    with open(path, "rb") as fh:
        model = pickle.load(fh)  # {"clf","reg","feature_names","version",...}
    model["source"] = source
    return model


def predict_from_features(feats: dict[str, float], company_id: str) -> dict:
    model = _load_model(company_id)

    import numpy as np

    x = np.array([[feats.get(n, 0.0) for n in model["feature_names"]]], dtype=float)
    prob = float(model["clf"].predict_proba(x)[0, 1])
    days = int(max(0, round(float(model["reg"].predict(x)[0]))))
    explanation = feature_contributions(model["clf"], x, model["feature_names"])
    return {
        "delay_probability": round(prob, 4),
        "predicted_delay_days": days,
        "model_version": model["version"],
        "explanation": explanation,
    }


def model_info(company_id: str) -> dict:
    """Technical details of the trained delay model, for an admin status view."""
    try:
        model = _load_model(company_id)
    except ModelUnavailable:
        return {"status": "not_trained", "method": "heuristic", "model_version": "heuristic-v0"}
    return {
        "status": "trained",
        "source": model.get("source", "trained"),
        "method": "ml",
        "model_version": model.get("version"),
        "trained_at": model.get("trained_at"),
        "n_rows": model.get("n_rows"),
        "feature_count": len(model.get("feature_names", [])),
        "metrics": model.get("metrics", {}),
    }


def predict_delay(invoice: dict, vendor_paid_history: list[dict], company_id: str) -> dict:
    """`invoice` keys: amount, tax_amount, department, invoice_date, po_id,
    direction, approval_chain_length (optional)."""
    inv_date = date.fromisoformat(str(invoice["invoice_date"])[:10])
    feats = assemble_features(
        vendor_ontime_rate=vendor_ontime_rate(vendor_paid_history),
        amount=float(invoice["amount"]),
        department=str(invoice.get("department") or ""),
        approval_chain_length=int(invoice.get("approval_chain_length") or 0),
        invoice_day_of_month=inv_date.day,
        tax_amount=float(invoice.get("tax_amount") or 0),
        po_matched=bool(invoice.get("po_id")),
        is_receivable=str(invoice.get("direction") or "payable") == "receivable",
    )
    return predict_from_features(feats, company_id)
