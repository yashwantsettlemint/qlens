"""notification-service — target of the `overdue_sweep_daily` Hasura cron trigger.

  POST /overdue-sweep   -> mark unpaid past-due invoices `overdue`, send a digest
  GET  /health
"""

from __future__ import annotations

import base64
import logging
import os
from datetime import date, datetime, timezone

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .hasura import HasuraError, find_past_due, mark_overdue
from .notify import format_digest, get_notifier, send_direct_email

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="notification-service", version="0.1.0")


class PaymentReceivedRequest(BaseModel):
    customer_email: str
    customer_name: str
    invoice_number: str
    amount: float
    paid_at: str


class SendInvoiceRequest(BaseModel):
    customer_email: str
    customer_name: str
    invoice_number: str
    pdf_base64: str


class DemoRequest(BaseModel):
    company_name: str
    contact_name: str
    work_email: str
    company_size: str | None = None
    message: str | None = None


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/overdue-sweep")
async def overdue_sweep() -> dict:
    today = date.today().isoformat()
    try:
        rows = await find_past_due(today)
        swept = await mark_overdue([r["id"] for r in rows])
    except HasuraError as exc:
        raise HTTPException(502, f"Hasura error during sweep: {exc}")

    subject, body = format_digest(rows)
    get_notifier().send(subject, body)

    # Payables only — this is telling the vendor *we* haven't paid *them* yet,
    # which only makes sense for money we owe, not money owed to us.
    vendor_notified = 0
    for r in rows:
        if r.get("direction") != "payable":
            continue
        vendor = r.get("vendor") or {}
        if not vendor.get("email"):
            continue
        sent = send_direct_email(
            vendor["email"],
            f"Invoice {r['invoice_number']} is now overdue",
            (
                f"Hi {vendor.get('name', 'there')},\n\n"
                f"Our records show invoice {r['invoice_number']} "
                f"(due {r['due_date']}, amount {r['amount']}) is now overdue on our end. "
                "We're working on getting this paid — thanks for your patience.\n"
            ),
        )
        vendor_notified += int(sent)

    return {
        "ran_at": datetime.now(timezone.utc).isoformat(),
        "as_of": today,
        "swept": swept,
        "invoice_ids": [r["id"] for r in rows],
        "digest_subject": subject,
        "vendor_notified": vendor_notified,
    }


@app.post("/notify/payment-received")
async def notify_payment_received(req: PaymentReceivedRequest) -> dict:
    """Best-effort receipt confirmation to a customer once their payment on a
    receivable invoice is recorded. Called synchronously from the web BFF's
    recordPayment mutation — never blocks or fails that mutation, so this
    endpoint always returns 200 even when the email itself didn't send."""
    sent = send_direct_email(
        req.customer_email,
        f"Payment received — invoice {req.invoice_number}",
        (
            f"Hi {req.customer_name},\n\n"
            f"We've received your payment of {req.amount} for invoice {req.invoice_number} "
            f"on {req.paid_at}. Thank you!\n"
        ),
    )
    return {"sent": sent}


@app.post("/notify/send-invoice")
async def notify_send_invoice(req: SendInvoiceRequest) -> dict:
    """Sends a generated invoice PDF to a customer. Called synchronously from
    the web BFF's generateAndSendInvoice mutation — never blocks or fails
    that mutation; the invoice is created and tracked either way, this is
    best-effort delivery on top of it."""
    try:
        pdf_bytes = base64.b64decode(req.pdf_base64)
    except (ValueError, TypeError):
        raise HTTPException(400, "pdf_base64 is not valid base64")
    sent = send_direct_email(
        req.customer_email,
        f"Invoice {req.invoice_number} from your supplier",
        f"Hi {req.customer_name},\n\nPlease find attached invoice {req.invoice_number}.\n\nThank you!\n",
        attachment=(f"{req.invoice_number}.pdf", pdf_bytes, "application/pdf"),
    )
    return {"sent": sent}


@app.post("/notify/demo-request")
async def notify_demo_request(req: DemoRequest) -> dict:
    """A prospect submitted the landing page's "Book a demo" form: notifies the
    ops inbox (EMAIL_TO, same recipient as the overdue digest) and sends the
    prospect a confirmation. Two independent best-effort sends — a bounce on
    one shouldn't hide whether the other got through."""
    to = [a.strip() for a in os.getenv("EMAIL_TO", "").split(",") if a.strip()]
    sent_team = False
    if to:
        sent_team = send_direct_email(
            to[0],
            f"Demo request — {req.company_name}",
            (
                f"{req.contact_name} at {req.company_name} ({req.work_email}) asked for a demo.\n\n"
                f"Company size: {req.company_size or 'not given'}\n\n"
                f"Message:\n{req.message or '(none)'}\n"
            ),
        )
    else:
        log.warning("EMAIL_TO unset — demo request from %s not forwarded to the team", req.work_email)

    sent_customer = send_direct_email(
        req.work_email,
        "We've got your request — Qlens demo",
        (
            f"Hi {req.contact_name},\n\n"
            f"Thanks for your interest in Qlens for {req.company_name}. Our team will get back to you "
            "within a business day to find a time that works.\n\n"
            "In the meantime, feel free to reply here with anything you'd like us to walk through.\n"
        ),
    )
    return {"sent": sent_team, "customer_notified": sent_customer}
