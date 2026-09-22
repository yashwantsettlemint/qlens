"""Turn a *structured* spec (from the LLM tool call, or the offline keyword
router) into a GraphQL query string against the whitelist. Never builds a query
from free text directly.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date

from . import whitelist as wl


@dataclass
class QuerySpec:
    table: str
    fields: list[str] = field(default_factory=list)
    where: dict = field(default_factory=dict)          # {"payment_status": {"_eq": "overdue"}}
    order_by: dict | None = None                        # {"due_date": "asc"}
    limit: int = 25
    include: list[str] = field(default_factory=list)    # relationship names from wl.RELATIONS


def _validate_where(table: str, where: dict) -> dict:
    allowed = set(wl.TABLES[table])
    for col, cond in where.items():
        if col not in allowed:
            raise wl.NotAllowed(f"filter column '{col}' not allowed on {table}")
        if not isinstance(cond, dict) or not set(cond).issubset(wl.FILTER_OPS):
            raise wl.NotAllowed(f"bad filter on '{col}' (ops: {sorted(wl.FILTER_OPS)})")
    return where


def build(spec: QuerySpec) -> tuple[str, dict]:
    fields = wl.check_fields(spec.table, spec.fields)
    where = _validate_where(spec.table, spec.where or {})
    limit = max(1, min(spec.limit, wl.MAX_LIMIT))

    selection = list(fields)
    for rel in spec.include:
        rel_fields = wl.RELATIONS.get(spec.table, {}).get(rel)
        # Unlike `where`/`fields` (strict — a bad filter should fail loud), an
        # unrecognised relationship is just dropped: some models occasionally
        # put a plain column name here instead of a real relationship, and
        # skipping it is harmless — the column is likely in `fields` already.
        if rel_fields:
            selection.append(f"{rel} {{ {' '.join(rel_fields)} }}")

    args = ["where: $where", f"limit: {limit}"]
    if spec.order_by:
        col, direction = next(iter(spec.order_by.items()))
        if col not in wl.TABLES[spec.table]:
            raise wl.NotAllowed(f"order_by column '{col}' not allowed")
        args.append(f"order_by: {{ {col}: {'desc' if str(direction).lower().startswith('d') else 'asc'} }}")

    query = (
        f"query GenAI($where: {spec.table}_bool_exp!) {{\n"
        f"  {spec.table}({', '.join(args)}) {{ {' '.join(selection)} }}\n"
        f"}}"
    )
    return query, {"where": where}


# ---- offline keyword router: question -> spec (no LLM) -----------------------

_STATUS_KEYWORDS = (
    # order matters: "unpaid" contains "paid", so check it first
    ("unpaid", "payment_status", "unpaid"),
    ("not paid", "payment_status", "unpaid"),
    ("paid", "payment_status", "paid"),
    ("awaiting approval", "approval_status", "pending"),
    ("pending", "approval_status", "pending"),
    ("approved", "approval_status", "approved"),
    ("rejected", "approval_status", "rejected"),
)


def route_offline(
    question: str, vendors: list[dict] | None = None
) -> tuple[QuerySpec, str]:
    """`vendors` (optional): [{"id", "name"}] so "invoices from <vendor>" can
    filter by vendor_id without an LLM."""
    q = question.lower()
    words = set(q.replace(",", " ").split())

    # "invoices from <vendor>" — match the full name or a distinctive first word
    for v in sorted(vendors or [], key=lambda x: -len(x.get("name", ""))):
        name = v.get("name", "")
        nl = name.lower()
        first = nl.split()[0] if nl else ""
        if nl and (nl in q or (len(first) >= 4 and first in words)):
            return (
                QuerySpec(
                    table="invoices",
                    where={"vendor_id": {"_eq": v["id"]}},
                    order_by={"invoice_date": "desc"},
                    include=["vendor"],
                    limit=100,
                ),
                f"invoices for {name}",
            )

    if "duplicate" in q:
        return (
            QuerySpec(
                table="duplicate_flags",
                order_by={"confidence_score": "desc"},
                limit=25,
            ),
            "duplicate flags, highest confidence first",
        )
    if "overdue" in q:
        # "overdue" is never a stored payment_status value (only paid/unpaid) —
        # it's derived, same as the frontend's effectivePaymentStatus(): unpaid
        # and past due.
        return (
            QuerySpec(
                table="invoices",
                where={
                    "payment_status": {"_neq": "paid"},
                    "due_date": {"_lt": date.today().isoformat()},
                },
                order_by={"due_date": "asc"},
                include=["vendor"],
                limit=50,
            ),
            "overdue invoices, oldest due date first",
        )
    for kw, col, val in _STATUS_KEYWORDS:
        if kw in q:
            return (
                QuerySpec(
                    table="invoices",
                    where={col: {"_eq": val}},
                    order_by={"invoice_date": "desc"},
                    include=["vendor"],
                    limit=100,
                ),
                f"{val} invoices",
            )
    if any(k in q for k in ("high-risk", "high risk", "late", "delay", "risk")):
        return (
            QuerySpec(
                table="delay_predictions",
                where={"delay_probability": {"_gte": 0.67}},
                order_by={"delay_probability": "desc"},
                limit=50,
            ),
            "invoices with a modelled late-payment probability of 67% or more",
        )
    if "vendor" in q:
        return QuerySpec(table="vendors", order_by={"name": "asc"}, limit=50), "all vendors"
    return (
        QuerySpec(table="invoices", order_by={"amount": "desc"}, include=["vendor"], limit=10),
        "the largest invoices by amount",
    )


def spec_from_tool_args(raw: str | dict) -> QuerySpec:
    d = json.loads(raw) if isinstance(raw, str) else raw
    return QuerySpec(
        table=d["table"],
        fields=d.get("fields", []),
        where=d.get("where", {}),
        order_by=d.get("order_by"),
        limit=int(d.get("limit", 25)),
        include=d.get("include", []),
    )
