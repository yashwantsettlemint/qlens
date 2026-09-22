"""Shared FastAPI dependency guarding service-to-service calls.

ingestion/ml/genai/notification/ocr are only ever called by the web BFF
(already does its own user auth before calling out) or by Hasura's own
event/cron triggers and actions (no end-user token in play) — never
directly by a browser. So the right check here is one shared secret both
sides know, not a user JWT. Fails closed: if INTERNAL_SERVICE_TOKEN isn't
set, every call is rejected rather than silently allowed.
"""

from __future__ import annotations

import os

from fastapi import Header, HTTPException


def require_internal_token(x_internal_token: str = Header(default="")) -> None:
    expected = os.getenv("INTERNAL_SERVICE_TOKEN", "")
    if not expected or x_internal_token != expected:
        raise HTTPException(401, "missing or invalid X-Internal-Token")
