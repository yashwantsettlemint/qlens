"""Runnable check:  python tests/test_chunking.py"""

from app.chunking import invoice_to_chunk_text


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
    t = invoice_to_chunk_text(inv)
    assert "Invoice TATA/26-27/1041 from Tata Consultancy Services" in t
    assert "IT" in t and "2026-07-25" in t
    assert "approved, paid" in t
    assert "Managed services x1 @ 1875000" in t

    # snake_case + no line items + no vendor object
    t2 = invoice_to_chunk_text({"invoice_number": "X/1", "vendor_name": "Globex", "amount": 10})
    assert "Invoice X/1 from Globex" in t2
    assert "none listed" in t2

    # totally empty -> still a string, no crash
    assert isinstance(invoice_to_chunk_text({}), str)

    print("genai-service chunking: all checks passed")


if __name__ == "__main__":
    run()
