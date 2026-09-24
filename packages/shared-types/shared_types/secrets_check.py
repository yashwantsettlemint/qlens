"""Refuses to boot in production with a secret still set to its dev-default
value — cheap insurance against shipping `devsecret`/`dev-jwt-signing-key...`
because ENV wasn't actually swapped over. Mirrors
apps/web/server/hasura.ts's assertProductionSecretsConfigured().

Gated on ENV=production (not e.g. presence of a hostname), set explicitly by
the deployment — this repo's own docker-compose dev stack must keep booting
with the shared dev secrets.
"""

from __future__ import annotations

import os

_DEV_MARKERS = ("devsecret", "dev-jwt-signing-key", "dev-internal-token", "dev-keycloak", "dev-nextauth")


def assert_production_secrets_configured(*env_vars: str) -> None:
    if os.getenv("ENV", "").lower() != "production":
        return
    for name in env_vars:
        value = os.getenv(name, "")
        if not value or any(marker in value for marker in _DEV_MARKERS):
            raise RuntimeError(f"{name} must be set to a real secret in production (ENV=production)")
