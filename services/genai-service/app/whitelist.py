"""What the LLM (and the offline path) is allowed to query. Nothing outside this
map reaches Hasura — no schema introspection, no arbitrary tables/fields. Matches
the genai_readonly grant (invoices, vendors).

duplicate_flags/delay_predictions were removed from here when they moved to
ml-service's own private ml_db (see services/ml-service/app/db.py) — Hasura
can no longer see them at all, so a structured question that used to resolve
to one of these tables now falls through to "I don't have that data" instead
of a direct answer. Accepted, deliberate degradation, not a bug.
"""

from __future__ import annotations

TABLES: dict[str, list[str]] = {
    "invoices": [
        "id", "invoice_number", "vendor_id", "invoice_date", "due_date",
        "amount", "tax_amount", "department", "approval_status", "payment_status", "source",
    ],
    "vendors": ["id", "name", "tax_id", "payment_terms_days"],
}

# nested relationships the builder may include, and their allowed fields
RELATIONS: dict[str, dict[str, list[str]]] = {
    "invoices": {
        "vendor": ["id", "name"],
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
