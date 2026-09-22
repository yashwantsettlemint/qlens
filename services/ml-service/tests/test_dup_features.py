"""Runnable check:  python tests/test_dup_features.py

Duplicate side: the pairwise feature funnel, detect() routing through the model,
and the no-fallback contract (missing model -> ModelUnavailable)."""

from app import ModelUnavailable, duplicates
from app.dup_features import DUP_FEATURE_NAMES, pair_features, vector


NEAR = (
    {"invoice_number": "HAVL/26-27/0455", "amount": 489700.0, "tax_amount": 88146.0,
     "po_id": "po-4", "invoice_date": "2026-07-01", "department": "IT"},
    {"invoice_number": "HAVL/26-27/O455", "amount": 489700.0, "tax_amount": 88146.0,
     "po_id": "po-4", "invoice_date": "2026-07-03", "department": "IT"},
)
FAR = (
    NEAR[0],
    {"invoice_number": "GLBX/26-27/0012", "amount": 12000.0, "tax_amount": 2160.0,
     "po_id": None, "invoice_date": "2026-02-01", "department": "Sales"},
)


class _FakeClf:
    """P(dup) high iff amounts match exactly and numbers are >90% similar."""

    def predict_proba(self, x):
        import numpy as np

        names = DUP_FEATURE_NAMES
        ae, nr = names.index("amount_exact"), names.index("num_ratio")
        p1 = [(0.95 if (row[ae] == 1.0 and row[nr] >= 0.9) else 0.05) for row in x]
        return np.array([[1 - p, p] for p in p1])


_FAKE_MODEL = {"clf": _FakeClf(), "feature_names": DUP_FEATURE_NAMES, "threshold": 0.5}


def run() -> None:
    # ---- feature funnel ----
    near = pair_features(*NEAR)
    far = pair_features(*FAR)
    assert len(vector(near)) == len(DUP_FEATURE_NAMES)
    assert near["amount_exact"] == 1.0 and near["same_po"] == 1.0 and near["dept_match"] == 1.0
    assert near["day_gap"] == 2.0 and near["num_ratio"] > 0.9
    assert far["amount_exact"] == 0.0 and far["same_po"] == 0.0
    assert far["num_ratio"] < near["num_ratio"] and far["dept_match"] == 0.0

    # ---- detect() routes through the model ----
    duplicates._load_model.cache_clear()
    orig = duplicates._load_model
    duplicates._load_model = lambda: _FAKE_MODEL
    try:
        cand = {"id": "c1", **NEAR[0]}
        existing = [{"id": "e1", **NEAR[1]}, {"id": "e2", **FAR[1]}]
        m = duplicates.detect(cand, existing)
        assert m and m.matched_invoice_id == "e1" and m.method == "ml", m
        assert 0.5 <= m.confidence_score <= 1.0

        # nothing similar enough -> no flag
        assert duplicates.detect(cand, [{"id": "e2", **FAR[1]}]) is None
    finally:
        duplicates._load_model = orig
        duplicates._load_model.cache_clear()

    # ---- no fallback: missing model -> ModelUnavailable ----
    orig_path = duplicates.DUPLICATE_MODEL_PATH
    duplicates.DUPLICATE_MODEL_PATH = orig_path.parent / "does_not_exist.pkl"
    duplicates._load_model.cache_clear()
    try:
        raised = False
        try:
            duplicates.detect({"id": "c1", **NEAR[0]}, [{"id": "e1", **NEAR[1]}])
        except ModelUnavailable:
            raised = True
        assert raised, "expected ModelUnavailable when the model file is absent"
    finally:
        duplicates.DUPLICATE_MODEL_PATH = orig_path
        duplicates._load_model.cache_clear()

    print("ml-service dup_features: all checks passed")


if __name__ == "__main__":
    run()
