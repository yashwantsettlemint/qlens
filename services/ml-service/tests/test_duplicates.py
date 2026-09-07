"""Runnable check:  python tests/test_duplicates.py"""

from app.duplicates import detect
from app.features import assemble_features, vector, FEATURE_NAMES, vendor_ontime_rate
from app.delay import predict_from_features


EXISTING = [
    {"id": "e1", "invoice_number": "HAVL/26-27/0455", "amount": 489700.0, "po_id": "po-4", "invoice_date": "2026-07-01"},
    {"id": "e2", "invoice_number": "ZERO/1", "amount": 12000.0, "po_id": None, "invoice_date": "2026-01-01"},
]


def run() -> None:
    # near-identical number + amount within 1% + close dates -> match
    cand = {"id": "c1", "invoice_number": "HAVL/26-27/0501", "amount": 489700.0,
            "po_id": "po-4", "invoice_date": "2026-07-02"}
    m = detect(cand, EXISTING)
    assert m and m.matched_invoice_id == "e1" and m.method == "rule_based", m
    assert 0.0 < m.confidence_score <= 1.0

    # amount off by >1% -> no match
    assert detect({**cand, "amount": 600000.0, "po_id": None, "invoice_number": "X"}, EXISTING) is None

    # dates too far apart -> no match
    assert detect({**cand, "invoice_date": "2026-09-30"}, EXISTING) is None

    # same vendor, no candidate -> None
    assert detect(cand, []) is None

    # feature funnel + heuristic prediction
    feats = assemble_features(
        vendor_ontime_rate=0.3, amount=250000, department="IT",
        approval_chain_length=2, invoice_day_of_month=27, tax_amount=45000, po_matched=False,
    )
    assert len(vector(feats)) == len(FEATURE_NAMES)
    assert feats["dept_IT"] == 1.0 and feats["po_matched"] == 0.0
    low = predict_from_features(assemble_features(
        vendor_ontime_rate=0.95, amount=1000, department="IT",
        approval_chain_length=1, invoice_day_of_month=3, tax_amount=180, po_matched=True))
    high = predict_from_features(feats)
    assert high["delay_probability"] > low["delay_probability"], (low, high)

    assert vendor_ontime_rate([]) == 0.7
    assert vendor_ontime_rate([{"due_date": "2026-01-31", "paid_at": "2026-01-15"}]) == 1.0

    print("ml-service: all checks passed")


if __name__ == "__main__":
    run()
