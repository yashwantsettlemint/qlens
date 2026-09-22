"""Async bulk document upload over RabbitMQ.

  POST /bulk/enqueue            multipart files[] -> [{job_id, filename, status}]
  GET  /bulk/status?ids=a,b,c   -> [{job_id, filename, status, result}]

The HTTP handler just saves each file and publishes a small job message
({job_id, path, filename}) — fast, so a big batch doesn't hold the request
open. A background consumer (started on FastAPI startup, same process) pulls
jobs off the queue one prefetch-batch at a time and runs the slow OCR/LLM
pipeline, so many uploads queue up instead of serializing behind each other's
network request. Files live in a local temp dir since the consumer runs in
this same container — no shared volume needed.

ponytail: job status lives in an in-memory dict — lost on restart, invisible
across replicas. Fine for a single-instance dev service; a real deployment
would move this to Redis or a `bulk_jobs` table.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import uuid
from pathlib import Path

import aio_pika

from . import pipeline

log = logging.getLogger("ocr-service.bulk")

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
QUEUE_NAME = "ocr.bulk"
UPLOAD_DIR = Path(tempfile.gettempdir()) / "ocr-bulk-uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

_JOBS: dict[str, dict] = {}  # job_id -> {filename, status, result}
_connection: aio_pika.abc.AbstractRobustConnection | None = None
_channel: aio_pika.abc.AbstractRobustChannel | None = None


async def _get_channel() -> aio_pika.abc.AbstractChannel:
    global _connection, _channel
    if _channel is None or _channel.is_closed:
        _connection = await aio_pika.connect_robust(RABBITMQ_URL)
        _channel = await _connection.channel()
        await _channel.set_qos(prefetch_count=2)  # a couple of documents OCR'd concurrently, not the whole batch
        await _channel.declare_queue(QUEUE_NAME, durable=True)
    return _channel


async def enqueue(raw: bytes, filename: str, company_id: str) -> str:
    job_id = uuid.uuid4().hex
    path = UPLOAD_DIR / f"{job_id}_{filename}"
    path.write_bytes(raw)
    _JOBS[job_id] = {"filename": filename, "status": "queued", "result": None}
    channel = await _get_channel()
    await channel.default_exchange.publish(
        aio_pika.Message(
            json.dumps(
                {"job_id": job_id, "path": str(path), "filename": filename, "company_id": company_id}
            ).encode(),
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        ),
        routing_key=QUEUE_NAME,
    )
    return job_id


def job_status(job_id: str) -> dict | None:
    job = _JOBS.get(job_id)
    return {"job_id": job_id, **job} if job else None


async def _handle_message(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process():
        payload = json.loads(message.body)
        job_id, path, filename = payload["job_id"], Path(payload["path"]), payload["filename"]
        company_id = payload["company_id"]
        job = _JOBS.setdefault(job_id, {"filename": filename, "status": "queued", "result": None})
        job["status"] = "processing"
        try:
            raw = path.read_bytes()
            job["result"] = await pipeline.process_document(raw, filename, None, company_id, always_queue=True)
            job["status"] = "done"
        except Exception as exc:  # one bad file shouldn't wedge the consumer
            log.exception("bulk job %s failed", job_id)
            job["status"] = "failed"
            job["result"] = {"issues": [str(exc)]}
        finally:
            path.unlink(missing_ok=True)


async def start_consumer() -> None:
    """Connect (retrying until RabbitMQ is up) and start consuming. Runs as a
    background task for the lifetime of the app — aio_pika's robust connection
    handles reconnects after that."""
    while True:
        try:
            channel = await _get_channel()
            queue = await channel.declare_queue(QUEUE_NAME, durable=True)
            await queue.consume(_handle_message)
            log.info("bulk upload consumer connected (%s)", RABBITMQ_URL)
            return
        except Exception:
            log.warning("rabbitmq not reachable yet, retrying in 3s", exc_info=True)
            await asyncio.sleep(3)
