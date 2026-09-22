"""Runnable check:  python tests/test_duplicates.py

Delay side: the feature funnel, the model-backed prediction path, and the
no-fallback contract (missing model -> ModelUnavailable)."""

import numpy as np

from app import ModelUnavailable, delay
from app.features import FEATURE_NAMES, assemble_features, vector, vendor_ontime_rate
from app.delay import predict_from_features


class _FakeClf:
    """P(late) = 1 - vendor_ontime_rate, so a worse payer scores higher."""

    def predict_proba(self, x):
        rate_i = FEATURE_NAMES.index("vendor_ontime_rate")
        p = [max(0.0, min(1.0, 1.0 - row[rate_i])) for row in x]
        return np.array([[1 - v, v] for v in p])


class _FakeReg:
    def predict(self, x):
        rate_i = FEATURE_NAMES.index("vendor_ontime_rate")
        return np.array([round((1.0 - row[rate_i]) * 25) for row in x])


_FAKE_MODEL = {
    "clf": _FakeClf(),
    "reg": _FakeReg(),
    "feature_names": FEATURE_NAMES,
    "version": "xgb-fake",
}


def run() -> None:
    # ---- feature funnel ----
    feats = assemble_features(
        vendor_ontime_rate=0.3, amount=250000, department="IT",
        approval_chain_length=2, invoice_day_of_month=27, tax_amount=45000, po_matched=False,
    )
    assert len(vector(feats)) == len(FEATURE_NAMES)
    assert feats["dept_IT"] == 1.0 and feats["po_matched"] == 0.0

    assert vendor_ontime_rate([]) == 0.7
    assert vendor_ontime_rate([{"due_date": "2026-01-31", "paid_at": "2026-01-15"}]) == 1.0

    # ---- model-backed prediction ----
    delay._load_model.cache_clear()
    orig = delay._load_model
    delay._load_model = lambda company_id: _FAKE_MODEL
    try:
        high = predict_from_features(feats, "company-1")
        low = predict_from_features(assemble_features(
            vendor_ontime_rate=0.95, amount=1000, department="IT",
            approval_chain_length=1, invoice_day_of_month=3, tax_amount=180, po_matched=True), "company-1")
        assert high["delay_probability"] > low["delay_probability"], (low, high)
        assert high["model_version"] == "xgb-fake"
    finally:
        delay._load_model = orig
        delay._load_model.cache_clear()

    # ---- no fallback: missing model -> ModelUnavailable ----
    orig_path = delay.MODEL_PATH
    delay.MODEL_PATH = orig_path.parent / "does_not_exist.pkl"
    delay._load_model.cache_clear()
    try:
        raised = False
        try:
            predict_from_features(feats, "company-1")
        except ModelUnavailable:
            raised = True
        assert raised, "expected ModelUnavailable when the model file is absent"
    finally:
        delay.MODEL_PATH = orig_path
        delay._load_model.cache_clear()

    print("ml-service delay: all checks passed")


if __name__ == "__main__":
    run()
