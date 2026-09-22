"""Runnable check:  python tests/test_validation.py"""

from app.validation import validate


def _conf(**over):
    base = {
        "vendor_name": 0.95,
        "invoice_number": 0.95,
        "invoice_date": 0.95,
        "due_date": 0.95,
        "amount": 0.95,
        "tax_amount": 0.95,
    }
    base.update(over)
    return base


def run() -> None:
    good = {
        "vendor_name": "Globex Corp",
        "invoice_number": "GLBX/1",
        "invoice_date": "2026-08-01",
        "due_date": "2026-08-31",
        "amount": 200000.0,  # pre-tax, same basis as line_amount — see extract()
        "tax_amount": 36000.0,
        "line_items": [{"description": "svc", "line_amount": 200000.0}],
        "field_confidences": _conf(),
    }
    ok, issues = validate(good)
    assert ok and issues == [], issues

    # low confidence on a financial field -> flagged (0.92 bar)
    bad_conf = {**good, "field_confidences": _conf(amount=0.85)}
    ok, issues = validate(bad_conf)
    assert not ok and any("low confidence on amount" in i for i in issues), issues

    # descriptive field at 0.85 is fine (0.80 bar)
    ok, _ = validate({**good, "field_confidences": _conf(vendor_name=0.85)})
    assert ok

    # arithmetic mismatch: line items (200000) != amount (250000)
    ok, issues = validate({**good, "amount": 250000.0})
    assert not ok and any("!= amount" in i for i in issues), issues

    # missing a required field
    ok, issues = validate({**good, "invoice_number": None})
    assert not ok and any("missing required" in i for i in issues), issues

    # no line items -> arithmetic check skipped
    ok, _ = validate({**good, "line_items": []})
    assert ok

    print("ocr-service validation: all checks passed")


if __name__ == "__main__":
    run()
