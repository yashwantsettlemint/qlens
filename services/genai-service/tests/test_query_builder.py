"""Runnable check:  python tests/test_query_builder.py"""

from app.query_builder import QuerySpec, build, route_offline, spec_from_tool_args
from app.whitelist import NotAllowed


def run() -> None:
    # offline routing
    spec, what = route_offline("which invoices are overdue?")
    assert spec.table == "invoices" and spec.where == {"payment_status": {"_eq": "overdue"}}
    q, v = build(spec)
    assert "invoices(" in q and "order_by: { due_date: asc }" in q
    assert v == {"where": {"payment_status": {"_eq": "overdue"}}}
    assert "vendor {" in q  # include=['vendor']

    spec, _ = route_offline("summarize high-risk invoices this month")
    assert spec.table == "delay_predictions" and spec.where == {"delay_probability": {"_gte": 0.67}}

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
