"""Runnable check:  python tests/test_ocr.py"""

from app.ocr import FIELDS, empty_fields, regex_fields, shape_llm_fields

SAMPLE = """
ACME SUPPLIES PVT LTD
Invoice Number: ACME/26-27/1099
Invoice Date: 2026-08-14
Due Date: 2026-09-13
Vendor: ACME Supplies Pvt Ltd
Department: Facilities
Total Amount: 120,000.00
GST Amount: 21,600.00
"""


def run() -> None:
    f = regex_fields(SAMPLE)
    assert set(f) == set(FIELDS)
    assert f["invoice_number"]["value"] == "ACME/26-27/1099"
    assert f["invoice_date"]["value"] == "2026-08-14"
    assert f["due_date"]["value"] == "2026-09-13"
    assert f["amount"]["value"] == 120000.0
    assert f["tax_amount"]["value"] == 21600.0
    assert f["amount"]["confidence"] > 0
    # a field that isn't in the text stays empty with zero confidence
    assert regex_fields("nothing useful here")["amount"]["value"] is None
    assert regex_fields("nothing useful here")["amount"]["confidence"] == 0.0

    # LLM tool-args -> the same {value, confidence} contract, numbers pass through
    shaped = shape_llm_fields({"invoice_number": "X/1", "amount": 500, "department": ""})
    assert shaped["invoice_number"] == {"value": "X/1", "confidence": 0.75}
    assert shaped["amount"]["value"] == 500
    assert shaped["department"]["confidence"] == 0.0

    assert all(v == {"value": None, "confidence": 0.0} for v in empty_fields().values())

    print("genai-service ocr: all checks passed")


if __name__ == "__main__":
    run()
