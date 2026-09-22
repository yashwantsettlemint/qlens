"""Confidence + arithmetic checks. `valid` gates auto-commit vs the review queue.

Financial fields (amounts, dates that drive due-date math) hold to a higher
confidence bar than descriptive fields.
"""

from __future__ import annotations

from .config import ARITHMETIC_TOLERANCE, CONF_FINANCIAL, CONF_OTHER

_FINANCIAL = {"amount", "tax_amount", "invoice_date"}
_REQUIRED = ("vendor_name", "invoice_number", "amount")
# buyer_name only feeds the payable/receivable guess (match.py) — a low read on
# it shouldn't send an otherwise-good invoice to the review queue. due_date is
# routinely absent from the document entirely (many invoices print payment
# terms, not an explicit due date) — the app derives it from invoice_date +
# terms either way, so a 0-confidence read on a field that was never there
# shouldn't block an otherwise-clean invoice.
_INFORMATIONAL = {"buyer_name", "due_date"}


def validate(extracted: dict) -> tuple[bool, list[str]]:
    issues: list[str] = []

    for field, conf in (extracted.get("field_confidences") or {}).items():
        if field in _INFORMATIONAL:
            continue
        need = CONF_FINANCIAL if field in _FINANCIAL else CONF_OTHER
        if conf < need:
            issues.append(f"low confidence on {field}: {conf:.2f} (need {need:.2f})")

    missing = [f for f in _REQUIRED if extracted.get(f) in (None, "")]
    if missing:
        issues.append(f"missing required field(s): {', '.join(missing)}")

    items = extracted.get("line_items") or []
    if items:
        line_total = sum(float(li.get("line_amount") or 0) for li in items)
        # `amount` is the pre-tax figure (see extract()) — same basis as each
        # line's line_amount, so compare directly rather than adding tax back.
        amount = float(extracted.get("amount") or 0)
        if abs(line_total - amount) > ARITHMETIC_TOLERANCE:
            issues.append(
                f"line items ({line_total:.2f}) != amount ({amount:.2f})"
            )

    return (len(issues) == 0, issues)
