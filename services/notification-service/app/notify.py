"""Digest delivery. Real channels (Slack, email) slot in behind Notifier —
NOTIFY_CHANNEL picks one. Default `log` just writes to stdout.
"""

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod

log = logging.getLogger("notification-service")


class Notifier(ABC):
    @abstractmethod
    def send(self, subject: str, body: str) -> None: ...


class LoggingNotifier(Notifier):
    def send(self, subject: str, body: str) -> None:
        log.warning("DIGEST — %s\n%s", subject, body)


# TODO: SlackNotifier(webhook_url) / EmailNotifier(smtp) — implement `send`, add to _CHANNELS.
_CHANNELS: dict[str, type[Notifier]] = {"log": LoggingNotifier}


def get_notifier() -> Notifier:
    channel = os.getenv("NOTIFY_CHANNEL", "log")
    return _CHANNELS.get(channel, LoggingNotifier)()


def format_digest(rows: list[dict]) -> tuple[str, str]:
    if not rows:
        return "Overdue sweep: nothing overdue", "All invoices are within terms."
    by_vendor: dict[str, list[dict]] = {}
    for r in rows:
        by_vendor.setdefault(r["vendor"]["name"], []).append(r)
    total = sum(float(r["amount"]) for r in rows)
    lines = [f"{len(rows)} invoices newly overdue — ₹{total:,.0f} total", ""]
    for vendor, items in sorted(by_vendor.items(), key=lambda kv: -sum(float(i["amount"]) for i in kv[1])):
        vt = sum(float(i["amount"]) for i in items)
        lines.append(f"  {vendor}: {len(items)} invoice(s), ₹{vt:,.0f}")
        for i in items:
            lines.append(f"    - {i['invoice_number']} due {i['due_date']} · ₹{float(i['amount']):,.0f}")
    return f"Overdue sweep: {len(rows)} invoices flagged", "\n".join(lines)
