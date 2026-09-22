"""Runnable check:  python tests/test_extract.py  (offline — regex path)"""

from app.extract import combine_pages, extract, extract_fields_regex

SAMPLE = """
Vendor: Globex Corp
Invoice Number: GLBX/26-27/0042
Invoice Date: 2026-08-01
Due Date: 2026-08-31
Grand Total: 2,36,000.00
GST Amount: 36,000.00
"""

# What real-invoice OCR looks like: two-column header interleaved, labels and
# values on separate lines, "05 Sep 2026" dates, Subtotal vs Total Due.
REAL = """
Dell Technologies India Pvt. Ltd.
DLF Cyber City, Building 10, Tower B
Gurugram, Haryana 122002, India
GSTIN: 06AACD1234E1ZP
BILL TO
INVOICE NUMBER
Acme Finance Corp Pvt. Ltd.
Procurement Department
Plot 42, Sector 18
Noida, Uttar Pradesh 201301
GSTIN: 09AAECA5678F1Z2
INV-DELL-2026-08421
INVOICE DATE
05 Sep 2026
DUE DATE
05 Oct 2026
PO NUMBER
PO-2026-3391
Dell 65W USB-C AC Adapter (Laptop Charger) IT Infrastructure 10 2,499.00 24,990.00
Subtotal 24,990.00
CGST @ 9% 2,249.10
SGST @ 9% 2,249.10
Total Due (INR) 29,488.20
Payment Terms: Net 30 days from invoice date.
"""


def run() -> None:
    # combine: direct page keeps conf 1.0; ocr page carries its avg_confidence
    routed = [
        {"page_num": 0, "method": "direct", "direct_text": "page one text"},
        {"page_num": 1, "method": "ocr", "direct_text": None},
    ]
    combined = combine_pages(routed, {1: {"text": "page two ocr", "avg_confidence": 0.83}})
    assert combined["full_text"] == "page one text\npage two ocr"
    assert combined["source_map"][0]["confidence"] == 1.0
    assert combined["source_map"][1] == {"page": 1, "method": "ocr", "confidence": 0.83}

    # regex extraction — clean labelled template
    f = extract_fields_regex(SAMPLE)
    assert f["invoice_number"] == "GLBX/26-27/0042"
    assert f["invoice_date"] == "2026-08-01" and f["due_date"] == "2026-08-31"
    # extract_fields_regex reports the raw grand total (incl. tax) — extract()
    # is what converts to the pre-tax figure everything downstream expects
    assert f["amount"] == 236000.0 and f["tax_amount"] == 36000.0
    assert f["vendor_name"] == "Globex Corp"

    # regex extraction — real-invoice OCR layout
    r = extract_fields_regex(REAL)
    assert r["invoice_number"] == "INV-DELL-2026-08421", r["invoice_number"]
    assert r["invoice_date"] == "2026-09-05", r["invoice_date"]
    assert r["due_date"] == "2026-10-05", r["due_date"]
    assert r["amount"] == 29488.20, r["amount"]            # raw Total Due (incl. tax)
    assert r["tax_amount"] == 4498.20, r["tax_amount"]     # CGST + SGST
    assert r["vendor_name"] and "Dell" in r["vendor_name"], r["vendor_name"]  # seller, not "Acme"

    # fully digital, regex path -> base regex confidence (0.5), no cap
    ex = extract(SAMPLE, [{"page": 0, "method": "direct", "confidence": 1.0}])
    assert ex["invoice_number"] == "GLBX/26-27/0042"
    assert ex["field_confidences"]["amount"] == 0.5          # regex base
    assert ex["field_confidences"]["vendor_name"] > 0        # "Globex Corp" found
    # extract() is where grand total (236000) becomes the pre-tax figure (200000)
    assert ex["amount"] == 200000.0, ex["amount"]

    # regex base (0.5) is already below a 0.6 OCR cap -> min() keeps 0.5
    ex_lo = extract(SAMPLE, [{"page": 0, "method": "ocr", "confidence": 0.6}])
    for c in ex_lo["field_confidences"].values():
        assert c in (0.0, 0.5), c

    # LLM path (base 0.97) DOES get capped by a low OCR page confidence
    import app.llm as llm_mod

    orig = llm_mod.extract_fields_llm
    llm_mod.extract_fields_llm = lambda _t: {
        "vendor_name": "Globex Corp", "invoice_number": "GLBX/26-27/0042",
        "invoice_date": "2026-08-01", "due_date": "2026-08-31",
        "amount": 236000.0, "tax_amount": 36000.0, "line_items": [],
    }
    try:
        capped = extract(SAMPLE, [{"page": 0, "method": "ocr", "confidence": 0.6}])
        assert all(c in (0.0, 0.6) for c in capped["field_confidences"].values()), capped["field_confidences"]
        digital = extract(SAMPLE, [{"page": 0, "method": "direct", "confidence": 1.0}])
        assert digital["field_confidences"]["amount"] == 0.97      # no OCR page -> uncapped
        # LLM also reports grand total (236000) — same net conversion applies
        assert digital["amount"] == 200000.0, digital["amount"]
    finally:
        llm_mod.extract_fields_llm = orig

    # a missing field stays at 0.0
    ex3 = extract("nothing useful here at all, no fields", [{"page": 0, "method": "direct", "confidence": 1.0}])
    assert ex3["field_confidences"]["amount"] == 0.0
    assert ex3["amount"] is None

    print("ocr-service extract: all checks passed")


if __name__ == "__main__":
    run()
