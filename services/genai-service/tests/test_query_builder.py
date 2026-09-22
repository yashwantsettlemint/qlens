"""Runnable check:  python tests/test_query_builder.py"""

from datetime import date

from app.query_builder import QuerySpec, build, route_offline, spec_from_tool_args
from app.whitelist import NotAllowed


def run() -> None:
    # offline routing
    spec, what = route_offline("which invoices are overdue?")
    # "overdue" is never a stored payment_status value (only paid/unpaid) — it's
    # derived: unpaid and past due date (see query_builder.py's route_offline).
    assert spec.table == "invoices" and spec.where == {
        "payment_status": {"_neq": "paid"},
        "due_date": {"_lt": date.today().isoformat()},
    }
    q, v = build(spec)
    assert "invoices(" in q and "order_by: { due_date: asc }" in q
    assert v == {"where": spec.where}
    assert "vendor {" in q  # include=['vendor']

    # delay_predictions moved to ml-service's own private db (Hasura can't see
    # it anymore) — this now falls through to the generic default, same as
    # any other question none of the keyword routes match.
    spec, _ = route_offline("summarize high-risk invoices this month")
    assert spec.table == "invoices" and spec.order_by == {"amount": "desc"}

    spec, _ = route_offline("anything at all")
    assert spec.table == "invoices" and spec.order_by == {"amount": "desc"}

    # whitelist enforcement
    try:
        build(QuerySpec(table="approvals"))
        raise AssertionError("approvals must be rejected")
    except NotAllowed:
        pass
    try:
        build(QuerySpec(table="invoices", fields=["created_by"]))
        raise AssertionError("non-whitelisted field must be rejected")
    except NotAllowed:
        pass
    try:
        build(QuerySpec(table="invoices", where={"amount": {"_evil": 1}}))
        raise AssertionError("bad operator must be rejected")
    except NotAllowed:
        pass

    # tool-args parsing + limit clamp
    s = spec_from_tool_args({"table": "invoices", "where": {"department": {"_eq": "IT"}}, "limit": 9999})
    q, v = build(s)
    assert "limit: 100" in q and v["where"] == {"department": {"_eq": "IT"}}

    print("genai-service: all checks passed")


if __name__ == "__main__":
    run()
