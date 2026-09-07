"""Digest delivery. Real channels (Slack, email) slot in behind Notifier —
NOTIFY_CHANNEL picks one. Default `log` just writes to stdout.

  NOTIFY_CHANNEL=log                              (default)
  NOTIFY_CHANNEL=slack  SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
  NOTIFY_CHANNEL=email  SMTP_HOST=... SMTP_PORT=587 SMTP_USER=... SMTP_PASSWORD=...
                        EMAIL_FROM=ap-bot@acme.test EMAIL_TO=ap-team@acme.test[,second@...]
                        SMTP_STARTTLS=1
"""

from __future__ import annotations

import json
import logging
import os
import smtplib
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from email.message import EmailMessage

log = logging.getLogger("notification-service")


class Notifier(ABC):
    @abstractmethod
    def send(self, subject: str, body: str) -> None: ...


class LoggingNotifier(Notifier):
    def send(self, subject: str, body: str) -> None:
        log.warning("DIGEST — %s\n%s", subject, body)


class SlackNotifier(Notifier):
    """Incoming-webhook POST. Falls back to a log line if the webhook is unset or fails."""

    def __init__(self, webhook_url: str | None = None) -> None:
        self.webhook_url = webhook_url or os.getenv("SLACK_WEBHOOK_URL", "")

    def send(self, subject: str, body: str) -> None:
        if not self.webhook_url:
            log.warning("SLACK_WEBHOOK_URL unset — digest not sent:\n%s\n%s", subject, body)
            return
        payload = json.dumps({"text": f"*{subject}*\n{body}"}).encode()
        req = urllib.request.Request(
            self.webhook_url, data=payload, headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 (webhook is operator-set)
                resp.read()
        except (urllib.error.URLError, TimeoutError) as exc:
            log.error("Slack digest failed (%s) — falling back to log:\n%s\n%s", exc, subject, body)


class EmailNotifier(Notifier):
    """SMTP. Reads SMTP_* / EMAIL_* from the environment; logs and returns if unconfigured."""

    def __init__(self) -> None:
        self.host = os.getenv("SMTP_HOST", "")
        self.port = int(os.getenv("SMTP_PORT", "587"))
        self.user = os.getenv("SMTP_USER", "")
        self.password = os.getenv("SMTP_PASSWORD", "")
        self.starttls = os.getenv("SMTP_STARTTLS", "1") not in ("0", "false", "")
        self.mail_from = os.getenv("EMAIL_FROM", self.user or "ap-bot@localhost")
        self.mail_to = [a.strip() for a in os.getenv("EMAIL_TO", "").split(",") if a.strip()]

    def send(self, subject: str, body: str) -> None:
        if not (self.host and self.mail_to):
            log.warning("SMTP_HOST / EMAIL_TO unset — digest not sent:\n%s\n%s", subject, body)
            return
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = self.mail_from
        msg["To"] = ", ".join(self.mail_to)
        msg.set_content(body)
        try:
            with smtplib.SMTP(self.host, self.port, timeout=15) as s:
                if self.starttls:
                    s.starttls()
                if self.user:
                    s.login(self.user, self.password)
                s.send_message(msg)
        except (smtplib.SMTPException, OSError) as exc:
            log.error("Email digest failed (%s) — falling back to log:\n%s\n%s", exc, subject, body)


_CHANNELS: dict[str, type[Notifier]] = {
    "log": LoggingNotifier,
    "slack": SlackNotifier,
    "email": EmailNotifier,
}


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
