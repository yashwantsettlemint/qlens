import os
from pathlib import Path

from shared_types import DEPARTMENTS  # noqa: F401  (re-exported for features.py)

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
# The flat path is the shared bootstrap model, trained on synthetic data at
# image build time (see Dockerfile) — no real customer data, so it's safe to
# serve to any company that hasn't trained its own model yet.
MODEL_PATH = Path(os.getenv("DELAY_MODEL_PATH", _ROOT / "models" / "delay_model.pkl"))
SYNTHETIC_CSV = _ROOT / "data" / "synthetic_invoices.csv"

# Optional trained duplicate classifier — when the .pkl is present, duplicates.py
# scores pairs with it instead of the rule gates (see ml/train_duplicates.py).
DUPLICATE_MODEL_PATH = Path(
    os.getenv("DUPLICATE_MODEL_PATH", _ROOT / "models" / "duplicate_model.pkl")
)
SYNTHETIC_DUP_CSV = _ROOT / "data" / "synthetic_duplicate_pairs.csv"


def company_model_path(company_id: str, base_path: Path) -> Path:
    """<models>/<company_id>/<model file>, alongside the flat bootstrap file
    at `base_path`. A real per-company retrain writes here; scoring falls
    back to `base_path` until that company has one."""
    return base_path.parent / company_id / base_path.name

# Drift detection thresholds — a feature is drifted if its Population
# Stability Index exceeds PSI_THRESHOLD (0.2 is the standard industry rule of
# thumb: <0.1 stable, 0.1-0.2 moderate shift, >0.2 significant); a model is
# drifted if live ROC-AUC/accuracy falls more than PERFORMANCE_DROP_THRESHOLD
# below what was recorded at training time.
PSI_THRESHOLD = float(os.getenv("ML_PSI_THRESHOLD", "0.2"))
PERFORMANCE_DROP_THRESHOLD = float(os.getenv("ML_PERFORMANCE_DROP_THRESHOLD", "0.07"))
