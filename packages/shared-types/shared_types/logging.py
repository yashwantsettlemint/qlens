"""One shared logging setup, called once at each service's startup, so log
level/format stop being whichever module happened to call logging.getLogger()
first (see PRODUCTION_READINESS.md's observability gap). Stdlib only — no
new dependency for JSON formatting a handful of fields.
"""

from __future__ import annotations

import json
import logging
import os
import time


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": round(time.time(), 3),
            "level": record.levelname,
            "service": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure_logging(service_name: str) -> None:
    """Call once, at import/startup time, before any other logging.basicConfig()
    in the process. LOG_LEVEL env var overrides the default (INFO)."""
    level = getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO)
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    logging.getLogger(service_name).setLevel(level)
