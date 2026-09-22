"""Runnable check:  python tests/test_chunking.py"""

from app.chunking import invoice_to_chunks


def run() -> None:
    inv = {
        "invoice_number": "TATA/26-27/1041",
        "vendor": {"name": "Tata Consultancy Services"},
        "amount": 1875000,
        "tax_amount": 337500,
        "department": "IT",
        "invoice_date": "2026-06-10",
        "due_date": "2026-07-25",
        "approval_status": "approved",
        "payment_status": "paid",
        "lineItems": [
            {"description": "Managed services", "quantity": 1, "unit_price": 1875000},
        ],
    }
    chunks = invoice_to_chunks(inv)
    assert len(chunks) == 1  # no extracted_text -> just the summary chunk
    t = chunks[0]
    assert "Invoice TATA/26-27/1041 from Tata Consultancy Services" in t
    assert "IT" in t and "2026-07-25" in t
    assert "approved, paid" in t
    assert "Managed services x1 @ 1875000" in t

    # snake_case + no line items + no vendor object
    t2 = invoice_to_chunks({"invoice_number": "X/1", "vendor_name": "Globex", "amount": 10})[0]
    assert "Invoice X/1 from Globex" in t2
    assert "none listed" in t2

    # totally empty -> still one chunk, a string, no crash
    empty_chunks = invoice_to_chunks({})
    assert len(empty_chunks) == 1
    assert isinstance(empty_chunks[0], str)

    # long extracted_text (multi-page OCR) -> summary chunk + windowed text chunks
    long_text = " ".join(f"word{i}" for i in range(400))
    chunks3 = invoice_to_chunks({"invoice_number": "Y/1", "extracted_text": long_text})
    assert len(chunks3) > 1
    assert chunks3[0].startswith("Invoice Y/1")
    assert all(c.startswith("Extracted document text (part ") for c in chunks3[1:])

    print("genai-service chunking: all checks passed")


if __name__ == "__main__":
    run()
