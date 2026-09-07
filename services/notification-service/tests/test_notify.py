"""Runnable check:  python tests/test_notify.py"""

from app.notify import LoggingNotifier, format_digest, get_notifier

ROWS = [
    {"invoice_number": "A/1", "due_date": "2026-01-01", "amount": "100000", "vendor": {"name": "Acme"}},
    {"invoice_number": "A/2", "due_date": "2026-02-01", "amount": "50000", "vendor": {"name": "Acme"}},
    {"invoice_number": "B/1", "due_date": "2026-01-15", "amount": "300000", "vendor": {"name": "Globex"}},
]


def run() -> None:
    assert isinstance(get_notifier(), LoggingNotifier)

    subject, body = format_digest(ROWS)
    assert "3 invoices flagged" in subject
    # Globex has the larger balance -> listed first
    assert body.index("Globex") < body.index("Acme")
    assert "₹450,000" in body and "A/1" in body

    empty_subject, empty_body = format_digest([])
    assert "nothing overdue" in empty_subject

    captured = {}
    class Spy(LoggingNotifier):
        def send(self, s, b):
            captured["s"], captured["b"] = s, b
    Spy().send(subject, body)
    assert captured["s"] == subject

    print("notification-service: all checks passed")


if __name__ == "__main__":
    run()
