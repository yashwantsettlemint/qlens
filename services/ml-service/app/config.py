import os
from pathlib import Path

from shared_types import (  # noqa: F401  (re-exported for callers)
    DEPARTMENTS,
    DUPLICATE_AMOUNT_TOLERANCE,
    DUPLICATE_DAY_WINDOW,
    DUPLICATE_FUZZY_THRESHOLD,
)

HASURA_ENDPOINT = (
    os.getenv("HASURA_ENDPOINT")
    or os.getenv("HASURA_GRAPHQL_ENDPOINT")
    or "http://localhost:8088/v1/graphql"
)
HASURA_ADMIN_SECRET = (
    os.getenv("HASURA_ADMIN_SECRET")
    or os.getenv("HASURA_GRAPHQL_ADMIN_SECRET")
    or "devsecret"
)

_ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = Path(os.getenv("DELAY_MODEL_PATH", _ROOT / "models" / "delay_model.pkl"))
SYNTHETIC_CSV = _ROOT / "data" / "synthetic_invoices.csv"
