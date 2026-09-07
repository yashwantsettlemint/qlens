"""What the LLM (and the offline path) is allowed to query. Nothing outside this
map reaches Hasura — no schema introspection, no arbitrary tables/fields. Matches
the genai_readonly grant (invoices, vendors, duplicate_flags, delay_predictions).
"""

from __future__ import annotations

TABLES: dict[str, list[str]] = {
    "invoices": [
        "id", "invoice_number", "vendor_id", "invoice_date", "due_date",
        "amount", "tax_amount", "department", "approval_status", "payment_status", "source",
    ],
    "vendors": ["id", "name", "tax_id", "payment_terms_days"],
    "duplicate_flags": [
        "id", "invoice_id", "matched_invoice_id", "confidence_score", "method", "reviewed_status",
    ],
    "delay_predictions": [
        "id", "invoice_id", "delay_probability", "predicted_delay_days", "model_version",
    ],
}

# nested relationships the builder may include, and their allowed fields
RELATIONS: dict[str, dict[str, list[str]]] = {
    "invoices": {
        "vendor": ["id", "name"],
        "duplicateFlag": ["confidence_score", "method", "reviewed_status"],
        "delayPrediction": ["delay_probability", "predicted_delay_days", "model_version"],
    },
}

FILTER_OPS = {"_eq", "_neq", "_gt", "_gte", "_lt", "_lte", "_in", "_like", "_ilike"}
MAX_LIMIT = 100


class NotAllowed(ValueError):
    pass


def check_table(table: str) -> None:
    if table not in TABLES:
        raise NotAllowed(f"table '{table}' is not queryable")


def check_fields(table: str, fields: list[str]) -> list[str]:
    check_table(table)
    allowed = set(TABLES[table])
    bad = [f for f in fields if f not in allowed]
    if bad:
        raise NotAllowed(f"fields not allowed on {table}: {', '.join(bad)}")
    return fields or TABLES[table]
