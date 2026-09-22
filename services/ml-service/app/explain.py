"""Explainable AI for both models — per-prediction feature contributions via
the `shap` package's TreeExplainer (exact SHAP values for tree ensembles).
Used by both delay.py (classifier) and duplicates.py.
"""

from __future__ import annotations

import numpy as np
import shap

_LABELS = {
    # delay model
    "vendor_ontime_rate": "Vendor's on-time payment history",
    "amount_log": "Invoice amount",
    "approval_chain_length": "Number of approvals required",
    "day_of_month": "Day of month invoiced",
    "tax_fraction": "Tax as a share of amount",
    "po_matched": "Matched to a purchase order",
    "is_receivable": "Receivable (owed to us) vs payable",
    # duplicate model
    "amount_rel_gap": "Amount difference between the two invoices",
    "amount_exact": "Exact amount match",
    "tax_rel_gap": "Tax amount difference",
    "day_gap": "Days between the two invoice dates",
    "same_month": "Same calendar month",
    "num_ratio": "Invoice number similarity",
    "num_partial": "Invoice number substring match",
    "num_token_sort": "Invoice number similarity (reordered)",
    "num_len_diff": "Invoice number length difference",
    "num_exact": "Identical invoice number",
    "same_po": "Same purchase order",
    "both_have_po": "Both invoices reference a PO",
    "dept_match": "Same department",
}


def _label(name: str) -> str:
    if name in _LABELS:
        return _LABELS[name]
    if name.startswith("dept_"):
        return f"Department ({name[len('dept_'):]})"
    return name


def feature_contributions(
    model, x_row: np.ndarray, feature_names: list[str], top_n: int = 5
) -> list[dict]:
    """Per-feature contribution to this one prediction, for a fitted
    XGBClassifier/XGBRegressor `model` and a single-row `x_row` (shape
    (1, n_features), in `feature_names` order). Returns the top `top_n`
    features by |contribution|, signed (positive = pushes the prediction
    up), skipping near-zero contributors.
    """
    if not hasattr(model, "get_booster"):
        return []  # not an XGBoost model (e.g. a test fake) — no contribs available
    explainer = shap.TreeExplainer(model)
    contribs = np.asarray(explainer.shap_values(x_row))
    # binary classifiers: shap_values is (1, n_features); take row 0 either way
    contribs = contribs.reshape(-1, len(feature_names))[0]
    pairs = sorted(zip(feature_names, contribs), key=lambda p: abs(p[1]), reverse=True)
    out = []
    for name, contrib in pairs[:top_n]:
        if abs(contrib) < 1e-6:
            continue
        value = float(x_row[0][feature_names.index(name)])
        out.append({
            "feature": name,
            "label": _label(name),
            "value": round(value, 4),
            "contribution": round(float(contrib), 4),
            "direction": "increases" if contrib > 0 else "decreases",
        })
    return out
