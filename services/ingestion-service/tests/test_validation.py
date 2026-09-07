"""Runnable check for the validation logic (no framework).

    cd services/ingestion-service && pip install -e . -e ../../packages/shared-types
    python tests/test_validation.py
"""

from app.validation import parse_csv, validate_row

VENDORS = {"acme ltd": "v-1", "globex corp": "v-2"}
POS = {"po-2026-1001": "p-1"}


def row(**over):
    base = dict(
        invoice_number="ACME/26-27/1",
        vendor="Acme Ltd",
        department="IT",
        invoice_date="2026-09-01",
        due_date="2026-10-01",
        amount="125000",
        tax_amount="22500",
        source="csv",
    )
    base.update(over)
    return base


def run() -> None:
    obj, errs = validate_row(row(), VENDORS, POS, "csv")
    assert not errs, errs
    assert obj["vendor_id"] == "v-1" and obj["amount"] == 125000.0 and "po_id" not in obj, obj

    obj, errs = validate_row(row(po_number="PO-2026-1001"), VENDORS, POS, "csv")
    assert not errs and obj["po_id"] == "p-1", (obj, errs)

    _, errs = validate_row(row(invoice_number=""), VENDORS, POS, "csv")
    assert "invoice_number is required" in errs, errs

    _, errs = validate_row(row(vendor="Unknown Traders"), VENDORS, POS, "csv")
    assert any("not a known vendor" in e for e in errs), errs

    _, errs = validate_row(row(po_number="PO-9999"), VENDORS, POS, "csv")
    assert any("not a known purchase order" in e for e in errs), errs

    _, errs = validate_row(row(amount="-1"), VENDORS, POS, "csv")
    assert "amount must not be negative" in errs, errs

    _, errs = validate_row(row(amount="abc"), VENDORS, POS, "csv")
    assert "amount must be a number" in errs, errs

    _, errs = validate_row(row(due_date="2026-08-01"), VENDORS, POS, "csv")
    assert "due_date is before invoice_date" in errs, errs

    _, errs = validate_row(row(department="Legal"), VENDORS, POS, "csv")
    assert any("department must be one of" in e for e in errs), errs

    _, errs = validate_row(row(source="fax"), VENDORS, POS, "csv")
    assert any("source must be one of" in e for e in errs), errs

    # header aliases + BOM + currency formatting
    parsed = parse_csv(
        "﻿invoiceNumber,vendor,dept,Invoice Date,dueDate,amount,gst\r\n"
        "ACME/2,Globex Corp,IT,2026-09-01,2026-10-01,\"1,000\",180\r\n".encode()
    )
    assert parsed == [
        {
            "invoice_number": "ACME/2",
            "vendor": "Globex Corp",
            "department": "IT",
            "invoice_date": "2026-09-01",
            "due_date": "2026-10-01",
            "amount": "1,000",
            "tax_amount": "180",
        }
    ], parsed
    obj, errs = validate_row(parsed[0], VENDORS, POS, "csv")
    assert not errs and obj["amount"] == 1000.0, (obj, errs)

    print("ingestion-service validation: all checks passed")


if __name__ == "__main__":
    run()
