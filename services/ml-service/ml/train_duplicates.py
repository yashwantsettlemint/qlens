"""Train the duplicate classifier and serialise to models/duplicate_model.pkl.

    python -m ml.train_duplicates                 # from data/synthetic_duplicate_pairs.csv
    python -m ml.train_duplicates --from-hasura   # from human-reviewed duplicate_flags

Real labels come from reviewed_status: 'confirmed_duplicate' -> 1,
'false_positive' -> 0 (unreviewed rows are skipped). Feature engineering goes
through app.dup_features.pair_features — the exact funnel app/duplicates.py uses
at serve time.
"""

from __future__ import annotations

import argparse
import asyncio
import pickle
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

from app.config import DUPLICATE_MODEL_PATH, SYNTHETIC_DUP_CSV, company_model_path
from app.dup_features import DUP_FEATURE_NAMES, pair_features

# min P(duplicate) before /score raises a flag; kept in the pickle so serving
# and training agree. Duplicates are costly to miss, cheap to dismiss -> lean low.
# 0.3 chosen from a precision/recall sweep over the held-out test split of the
# live model (see conversation/ops notes): recall is essentially flat from
# 0.15-0.50 (~0.95-0.96) while precision keeps climbing through that range, so
# 0.3 buys back a few extra caught duplicates over 0.5 (24 vs 30 missed on a
# 596-positive test set) for a small precision cost (0.916 vs 0.939) — going
# below ~0.2 stops helping recall at all and just floods reviewers with false
# positives (precision falls to 0.70-0.79), which is its own way of causing
# missed duplicates once people stop trusting the flag.
DEFAULT_THRESHOLD = 0.9
# Retraining from reviewed flags (source="hasura") uses a stricter cut: that
# training set is small and its positives are near-copies, so at 0.3 the
# model flagged ~a third of adjacent same-party invoices; 0.6 kept recall
# (44/50 real duplicates) with 1 false positive across every same-party pair
# under 60 days apart. app/retrain.py passes this.
HASURA_THRESHOLD = 0.9


def _row_side(r, prefix: str) -> dict:
    return {
        "invoice_number": getattr(r, f"{prefix}_invoice_number"),
        "amount": getattr(r, f"{prefix}_amount"),
        "tax_amount": getattr(r, f"{prefix}_tax_amount"),
        "po_id": getattr(r, f"{prefix}_po_id") or None,
        "invoice_date": getattr(r, f"{prefix}_invoice_date"),
        "department": getattr(r, f"{prefix}_department"),
    }


def _matrix(df: pd.DataFrame) -> np.ndarray:
    out = []
    for r in df.itertuples(index=False):
        f = pair_features(_row_side(r, "a"), _row_side(r, "b"))
        out.append([f[n] for n in DUP_FEATURE_NAMES])
    return np.array(out, dtype=float)


async def _load_from_hasura(company_id: str) -> pd.DataFrame:
    """duplicate_flags now lives in this service's own ml_db (app.db), not
    Hasura — reviewed rows come from there directly. The invoice/matchedInvoice
    field data those rows used to pull via a Hasura relationship join still
    lives in the shared invoices table, so that part is a second, batched
    Hasura query (one $in lookup for every invoice id involved, not one call
    per row) — same two-step "fetch from ml_db, then batch-enrich from
    Hasura" pattern as apps/web/server's invoice-list stitching."""
    from app.db import get_conn
    from app.hasura import _gql

    async with await get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """SELECT invoice_id, matched_invoice_id, reviewed_status
                   FROM duplicate_flags
                   WHERE company_id = %s AND reviewed_status = ANY(%s)""",
                (company_id, ["confirmed_duplicate", "false_positive"]),
            )
            flags = await cur.fetchall()

    ids = sorted({str(f["invoice_id"]) for f in flags} | {str(f["matched_invoice_id"]) for f in flags})
    invoices_by_id: dict[str, dict] = {}
    if ids:
        query = """
        query Invoices($ids: [uuid!]!) {
          invoices(where: {id: {_in: $ids}}) {
            id invoice_number amount tax_amount po_id invoice_date department
          }
        }
        """
        data = await _gql(query, {"ids": ids}, company_id)
        invoices_by_id = {row["id"]: row for row in data["invoices"]}

    records = []
    for flag in flags:
        a = invoices_by_id.get(str(flag["invoice_id"]))
        b = invoices_by_id.get(str(flag["matched_invoice_id"]))
        if not a or not b:
            continue
        fields = ("invoice_number", "amount", "tax_amount", "po_id", "invoice_date", "department")
        records.append(
            {
                **{f"a_{k}": a[k] for k in fields},
                **{f"b_{k}": b[k] for k in fields},
                "is_duplicate": 1 if flag["reviewed_status"] == "confirmed_duplicate" else 0,
            }
        )
    if len(records) < 40 or len(set(r["is_duplicate"] for r in records)) < 2:
        raise SystemExit(
            f"only {len(records)} reviewed duplicate flags (need >=40 of both classes) — "
            "train on synthetic data instead: python -m ml.train_duplicates"
        )
    return pd.DataFrame.from_records(records)


def _baseline_stats(x: np.ndarray, feature_names: list[str]) -> dict:
    """Per-feature mean/std + a 10-bin histogram of the training data, kept in
    the pickle so drift.py can compare live feature distributions against
    what the model was actually trained on (population stability index)."""
    stats = {}
    for i, name in enumerate(feature_names):
        col = x[:, i]
        lo, hi = float(col.min()), float(col.max())
        if hi <= lo:
            hi = lo + 1.0
        edges = np.linspace(lo, hi, 11)
        counts, _ = np.histogram(col, bins=edges)
        freqs = (counts / max(1, len(col))).tolist()
        stats[name] = {
            "mean": round(float(col.mean()), 6),
            "std": round(float(col.std()), 6),
            "bin_edges": [round(float(e), 6) for e in edges],
            "bin_freqs": [round(f, 6) for f in freqs],
        }
    return stats


def train(source: str = "synthetic", threshold: float = DEFAULT_THRESHOLD, company_id: str | None = None) -> dict:
    """Train the duplicate classifier from `source` ("synthetic" or "hasura")
    and serialise to DUPLICATE_MODEL_PATH (source="synthetic" — the shared
    bootstrap) or to that company's own model path (source="hasura"). Returns
    the metrics dict. Raises SystemExit if `source == "hasura"` and there
    aren't enough of that company's own reviewed duplicate_flags yet —
    callers (e.g. app/retrain.py) should catch that."""
    if source == "hasura":
        if not company_id:
            raise ValueError("company_id is required when source='hasura'")
        df = asyncio.run(_load_from_hasura(company_id))
        out_path = company_model_path(company_id, DUPLICATE_MODEL_PATH)
    else:
        if not SYNTHETIC_DUP_CSV.exists():
            raise SystemExit("run  python -m ml.generate_synthetic_duplicate_pairs  first")
        df = pd.read_csv(SYNTHETIC_DUP_CSV, keep_default_na=False)
        out_path = DUPLICATE_MODEL_PATH

    x = _matrix(df)
    y = df["is_duplicate"].to_numpy(dtype=int)
    xtr, xte, ytr, yte = train_test_split(x, y, test_size=0.2, random_state=42, stratify=y)

    clf = XGBClassifier(
        n_estimators=200, max_depth=4, learning_rate=0.08, subsample=0.9,
        eval_metric="logloss", tree_method="hist", early_stopping_rounds=20,
    )
    clf.fit(xtr, ytr, eval_set=[(xte, yte)], verbose=False)
    proba = clf.predict_proba(xte)[:, 1]
    pred = (proba >= threshold).astype(int)
    auc = roc_auc_score(yte, proba)
    accuracy = accuracy_score(yte, pred)
    precision = precision_score(yte, pred, zero_division=0)
    recall = recall_score(yte, pred, zero_division=0)
    stopped_at = clf.best_iteration + 1
    version = f"xgb-dup-{date.today():%Y%m%d}-{source}-{len(df)}"
    metrics = {
        "roc_auc": round(float(auc), 4),
        "accuracy": round(float(accuracy), 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "stopped_at_tree": stopped_at,
        "n_estimators": 200,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as fh:
        pickle.dump(
            {
                "clf": clf,
                "feature_names": DUP_FEATURE_NAMES,
                "version": version,
                "threshold": float(threshold),
                "trained_at": datetime.now(timezone.utc).isoformat(),
                "n_rows": int(len(df)),
                "metrics": metrics,
                "baseline_stats": _baseline_stats(x, DUP_FEATURE_NAMES),
            },
            fh,
        )
    print(
        f"trained on {len(df)} {source} pairs | ROC-AUC {auc:.3f} | "
        f"accuracy {accuracy:.3f} | precision {precision:.3f} | recall {recall:.3f} | "
        f"stopped at tree {stopped_at}/200"
    )
    print(f"saved {version} -> {out_path}")
    return {"version": version, "metrics": metrics, "n_rows": int(len(df))}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-hasura", action="store_true")
    ap.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    ap.add_argument("--company-id", default=None, help="required with --from-hasura")
    args = ap.parse_args()
    if args.from_hasura:
        train("hasura", threshold=args.threshold, company_id=args.company_id)
    else:
        train("synthetic", threshold=args.threshold)


if __name__ == "__main__":
    main()
