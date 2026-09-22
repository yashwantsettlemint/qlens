"""Async outbound notification delivery over RabbitMQ.

Producer: apps/web/server/queue.ts (Node, amqplib) publishes {type, payload}
JSON messages to `notify.outbound`. The consumer here dispatches to the same
send_direct_email() the /notify/* HTTP endpoints already use (main.py) — no
logic duplication; those endpoints stay as-is for manual retry during
rollout. A handler that raises nacks the message to the dead-letter queue
`notify.outbound.dlq` (visible in RabbitMQ's management UI), instead of the
silent drop-on-exception behavior in ocr-service/app/bulk.py, which this
mirrors otherwise.

ponytail: no status store — matches the fire-and-forget contract these two
call sites already had before they were queued; nothing polls delivery
status today. If that changes, add a store deliberately for that need, don't
repeat bulk.py's in-memory-dict gap by pre-emptively inventing a second one.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os

import aio_pika

from .notify import send_direct_email

log = logging.getLogger("notification-service.queue")

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
QUEUE_NAME = "notify.outbound"
DLQ_NAME = "notify.outbound.dlq"
_QUEUE_ARGS = {"x-dead-letter-exchange": "", "x-dead-letter-routing-key": DLQ_NAME}

_connection: aio_pika.abc.AbstractRobustConnection | None = None
_channel: aio_pika.abc.AbstractRobustChannel | None = None


async def _get_channel() -> aio_pika.abc.AbstractChannel:
    global _connection, _channel
    if _channel is None or _channel.is_closed:
        _connection = await aio_pika.connect_robust(RABBITMQ_URL)
        _channel = await _connection.channel()
        await _channel.set_qos(prefetch_count=4)
        await _channel.declare_queue(DLQ_NAME, durable=True)
        await _channel.declare_queue(QUEUE_NAME, durable=True, arguments=_QUEUE_ARGS)
    return _channel


async def _handle_message(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process():
        payload = json.loads(message.body)
        kind = payload.get("type")
        job = payload.get("payload", {})
        if kind == "payment-received":
            send_direct_email(
                job["customer_email"],
                f"Payment received — invoice {job['invoice_number']}",
                (
                    f"Hi {job['customer_name']},\n\n"
                    f"We've received your payment of {job['amount']} for invoice {job['invoice_number']} "
                    f"on {job['paid_at']}. Thank you!\n"
                ),
            )
        elif kind == "send-invoice":
            pdf_bytes = base64.b64decode(job["pdf_base64"])
            send_direct_email(
                job["customer_email"],
                f"Invoice {job['invoice_number']} from your supplier",
                f"Hi {job['customer_name']},\n\nPlease find attached invoice {job['invoice_number']}.\n\nThank you!\n",
                attachment=(f"{job['invoice_number']}.pdf", pdf_bytes, "application/pdf"),
            )
        else:
            log.warning("notify.outbound: unknown message type %r — dropping", kind)


async def start_consumer() -> None:
    """Connect (retrying until RabbitMQ is up) and start consuming. Runs as a
    background task for the lifetime of the app — aio_pika's robust
    connection handles reconnects after that. Mirrors ocr-service/app/bulk.py."""
    while True:
        try:
            channel = await _get_channel()
            queue = await channel.declare_queue(QUEUE_NAME, durable=True, arguments=_QUEUE_ARGS)
            await queue.consume(_handle_message)
            log.info("notification outbound consumer connected (%s)", RABBITMQ_URL)
            return
        except Exception:
            log.warning("rabbitmq not reachable yet, retrying in 3s", exc_info=True)
            await asyncio.sleep(3)
