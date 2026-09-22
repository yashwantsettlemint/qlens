"""Runnable check:  python tests/test_match.py"""

from app.match import infer_direction

COMPANY = {"name": "Acme Private Limited", "aliases": ["Acme Pvt Ltd"]}


def run():
    # we're the buyer (bill-to line) -> we owe money -> payable
    r = infer_direction(vendor_name="Globex Corp", buyer_name="ACME PVT. LTD.", company=COMPANY)
    assert r["direction"] == "payable", r
    assert r["counterparty_name"] == "Globex Corp", r

    # we're the vendor (seller) -> money owed to us -> receivable
    r = infer_direction(vendor_name="Acme Private Limited", buyer_name="Some Customer Co", company=COMPANY)
    assert r["direction"] == "receivable", r
    assert r["counterparty_name"] == "Some Customer Co", r

    # neither side matches -> no guess, caller falls back to today's default
    r = infer_direction(vendor_name="Globex Corp", buyer_name="Initech LLC", company=COMPANY)
    assert r["direction"] is None, r

    # no company configured yet -> no guess
    r = infer_direction(vendor_name="Globex Corp", buyer_name="Acme Pvt Ltd", company={"name": "", "aliases": []})
    assert r["direction"] is None, r

    # abbreviated company name vs. the invoice's full legal name (real-world
    # regression: "settlemint india" vs. "Settlemint India Services Private
    # Limited" scored 0.78, under the old 0.82 threshold, and silently
    # defaulted to payable on a real receivable)
    short_co = {"name": "settlemint india", "aliases": []}
    r = infer_direction(
        vendor_name="Settlemint India Services Private Limited",
        buyer_name="State Bank of India, IT-Internet Banking Department (ISD)",
        company=short_co,
    )
    assert r["direction"] == "receivable", r

    print("ocr-service match: all checks passed")


if __name__ == "__main__":
    run()
