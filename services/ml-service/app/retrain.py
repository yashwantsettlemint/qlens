"""Retraining orchestration — records an ml_retrain_events row, runs the
matching trainer (ml/train.py or ml/train_duplicates.py) against real Hasura
data, and hot-swaps the in-memory model on success by clearing its
`lru_cache` — the next request loads the freshly written pickle, no restart
needed (matches the Dockerfile's models/ volume-mount: "host-trained models
win... no rebuild").
"""

from __future__ import annotations

import asyncio
import functools
from datetime import datetime, timezone

from . import hasura
from .delay import _load_model as _load_delay_model
from .delay import model_info as delay_model_info
from .duplicates import _load_model as _load_duplicate_model
from .duplicates import model_info as duplicate_model_info


def _trainers():
    # imported lazily so a plain /health check doesn't pull in xgboost's
    # training-only deps — only a real retrain does.
    from ml import train as delay_train
    from ml import train_duplicates as dup_train

    return {"delay": delay_train.train, "duplicate": dup_train.train}


async def retrain_model(model_name: str, triggered_by: str, company_id: str) -> dict:
    if model_name not in ("delay", "duplicate"):
        raise ValueError(f"unknown model_name {model_name!r}")

    old_info = delay_model_info(company_id) if model_name == "delay" else duplicate_model_info(company_id)
    event_id = await hasura.insert_retrain_event(
        {
            "model_name": model_name,
            "triggered_by": triggered_by,
            "status": "running",
            "old_version": old_info.get("model_version"),
            "old_metrics": old_info.get("metrics") or {},
        },
        company_id,
    )

    trainer = _trainers()[model_name]
    loop = asyncio.get_event_loop()
    try:
        # trainer() calls asyncio.run() internally for its Hasura fetch, so it
        # must run off this coroutine's already-running event loop. functools.partial,
        # not positional args — ml.train.train and ml.train_duplicates.train
        # don't share a parameter order past `source`.
        result = await loop.run_in_executor(
            None, functools.partial(trainer, "hasura", company_id=company_id)
        )
    except SystemExit as exc:
        await hasura.update_retrain_event(event_id, {
            "status": "skipped_insufficient_data",
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
        })
        return {"status": "skipped_insufficient_data", "detail": str(exc), "event_id": event_id}
    except Exception as exc:
        await hasura.update_retrain_event(event_id, {
            "status": "failed",
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
        })
        raise

    # lru_cache has no per-key eviction — clears every company's cached model,
    # not just this one's; correct (next call reloads from disk), just a
    # little wasteful. Fine at this call frequency.
    (_load_delay_model if model_name == "delay" else _load_duplicate_model).cache_clear()

    await hasura.update_retrain_event(event_id, {
        "status": "succeeded",
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "new_version": result["version"],
        "new_metrics": result["metrics"],
    })
    return {"status": "succeeded", "event_id": event_id, **result}
