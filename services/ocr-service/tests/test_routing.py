"""Runnable check:  python tests/test_routing.py"""

from app.routing import is_pdf, is_real_text

DIGITAL = """
ACME SUPPLIES PVT LTD
Invoice Number: ACME/26-27/1099
Invoice Date: 2026-08-14   Due Date: 2026-09-13
Vendor: ACME Supplies Pvt Ltd (GST 27AAACA1234A1Z5)
Total Amount: 1,20,000.00   GST Amount: 21,600.00
Terms: R&D services, net 30
"""

# what a bad embedded OCR layer looks like: short tokens, punctuation soup
GARBLED = "l|1 ~= ¬¬ \x0c fl1 .. ,, // \x01\x02 rn rn cl cl 1I1I ~~ ¤¤ €€ °° ±±"


def run() -> None:
    assert is_real_text(DIGITAL) is True
    assert is_real_text(GARBLED) is False
    assert is_real_text("") is False
    assert is_real_text("Invoice 12") is False               # too short
    assert is_real_text("x " * 60) is False                  # avg word len <= 2

    # apostrophes / ampersands / currency must NOT count as gibberish
    assert is_real_text(
        "Vendor's invoice for R&D work, total ₹1,20,000 incl. (GST). "
        "Payment due 2026-09-13. Reference PO-2026-1001 for the engagement."
    ) is True

    assert is_pdf(b"%PDF-1.7\n...", None) is True
    assert is_pdf(b"\x89PNG\r\n", "image/png") is False
    assert is_pdf(b"anything", "application/pdf") is True

    print("ocr-service routing: all checks passed")


if __name__ == "__main__":
    run()
