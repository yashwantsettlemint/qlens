"""Row normalisation + validation. Shared by the CSV and manual endpoints so a
row commits only if it would have passed the preview. Plain `csv` module, no
pandas."""

from __future__ import annotations

import csv
import io
from datetime import date
from typing import Any

from shared_types import DEPARTMENTS, InvoiceSource

REQUIRED = ("invoice_number", "vendor", "department", "invoice_date", "due_date", "amount")

# header synonyms -> canonical field name (compared after strip/lower/underscore)
_ALIASES = {
    "invoicenumber": "invoice_number",
    "invoice_no": "invoice_number",
    "vendorname": "vendor",
    "supplier": "vendor",
    "dept": "department",
    "invoicedate": "invoice_date",
    "duedate": "due_date",
    "taxamount": "tax_amount",
    "tax": "tax_amount",
    "gst": "tax_amount",
    "ponumber": "po_number",
    "po": "po_number",
    "po_no": "po_number",
}
_SOURCES = {s.value for s in InvoiceSource}


def _canon(header: str) -> str:
    h = header.strip().lower().replace(" ", "_").replace("-", "_")
    return _ALIASES.get(h.replace("_", ""), h)


def parse_csv(raw: bytes) -> list[dict[str, str]]:
    """Bytes of a CSV -> list of {canonical_field: trimmed_string}."""
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    return [
        {_canon(k): (v or "").strip() for k, v in row.items() if k}
        for row in reader
    ]


def _to_date(s: str) -> date | None:
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _to_num(s: str) -> float | None:
    try:
        return float(s.replace(",", "").replace("₹", "").strip())
    except (ValueError, AttributeError):
        return None


def validate_row(
    row: dict[str, str],
    vendor_id_by_name: dict[str, str],
    po_id_by_number: dict[str, str],
    default_source: str,
) -> tuple[dict[str, Any] | None, list[str]]:
    """Returns (insert_object, []) when valid, else (None, [human-readable errors])."""
    errors: list[str] = []

    for field in REQUIRED:
        if not row.get(field):
            errors.append(f"{field} is required")

    vendor_id = None
    vendor_name = row.get("vendor", "")
    if vendor_name:
        vendor_id = vendor_id_by_name.get(vendor_name.lower())
        if not vendor_id:
            errors.append(f"vendor '{vendor_name}' is not a known vendor")

    po_id = None
    po_number = row.get("po_number", "")
    if po_number:
        po_id = po_id_by_number.get(po_number.lower())
        if not po_id:
            errors.append(f"po_number '{po_number}' is not a known purchase order")

    department = row.get("department", "")
    if department and department not in DEPARTMENTS:
        errors.append(f"department must be one of: {', '.join(DEPARTMENTS)}")

    invoice_date = _to_date(row.get("invoice_date", ""))
    if row.get("invoice_date") and invoice_date is None:
        errors.append("invoice_date must be a valid date (YYYY-MM-DD)")
    due_date = _to_date(row.get("due_date", ""))
    if row.get("due_date") and due_date is None:
        errors.append("due_date must be a valid date (YYYY-MM-DD)")
    if invoice_date and due_date and due_date < invoice_date:
        errors.append("due_date is before invoice_date")

    amount = _to_num(row.get("amount", ""))
    if row.get("amount") and amount is None:
        errors.append("amount must be a number")
    elif amount is not None and amount < 0:
        errors.append("amount must not be negative")

    tax_amount = _to_num(row.get("tax_amount") or "0")
    if tax_amount is None:
        errors.append("tax_amount must be a number")
    elif tax_amount < 0:
        errors.append("tax_amount must not be negative")

    source = (row.get("source") or default_source).lower()
    if source not in _SOURCES:
        errors.append(f"source must be one of: {', '.join(sorted(_SOURCES))}")

    if errors:
        return None, errors

    obj: dict[str, Any] = {
        "invoice_number": row["invoice_number"],
        "vendor_id": vendor_id,
        "invoice_date": row["invoice_date"],
        "due_date": row["due_date"],
        "amount": amount,
        "tax_amount": tax_amount,
        "department": department,
        "source": source,
    }
    if po_id:
        obj["po_id"] = po_id
    return obj, []
