"""Train the delay classifier + regressor and serialise to models/delay_model.pkl.

    python -m ml.train                 # from data/synthetic_invoices.csv
    python -m ml.train --from-hasura   # from real paid invoices via GraphQL

Feature engineering goes through app.features.assemble_features — the exact funnel
app/delay.py uses at serve time.
"""

from __future__ import annotations

import argparse
import asyncio
import pickle
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    mean_absolute_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier, XGBRegressor

from app.config import MODEL_PATH, SYNTHETIC_CSV, company_model_path
from app.features import FEATURE_NAMES, assemble_features


def _rows_to_matrix(df: pd.DataFrame) -> np.ndarray:
    out = []
    for r in df.itertuples(index=False):
        feats = assemble_features(
            vendor_ontime_rate=float(r.vendor_ontime_rate),
            amount=float(r.amount),
            department=str(r.department),
            approval_chain_length=int(r.approval_chain_length),
            invoice_day_of_month=int(r.invoice_day_of_month),
            tax_amount=float(r.tax_amount),
            po_matched=bool(int(r.po_matched)),
            is_receivable=bool(int(r.is_receivable)),
        )
        out.append([feats[n] for n in FEATURE_NAMES])
    return np.array(out, dtype=float)


async def _load_from_hasura(company_id: str) -> pd.DataFrame:
    from app.hasura import _gql  # reuse the admin client

    # Both directions: a payable's party history is its vendor's, a
    # receivable's is its customer's. Same feature funnel for both. Only the
    # outer filter needs company_id — a vendor/customer row (and so all of
    # its own invoices, via the nested relationship below) already belongs
    # to exactly one company.
    query = """
    query Paid($companyId: uuid!) {
      invoices(where: {payment_status: {_eq: "paid"}, company_id: {_eq: $companyId}}) {
        id amount tax_amount department po_id invoice_date due_date
        approvals_aggregate { aggregate { count } }
        payments(order_by: {paid_at: asc}, limit: 1) { paid_at }
        vendor {
          invoices(where: {payment_status: {_eq: "paid"}}) {
            id invoice_date due_date payments(order_by: {paid_at: asc}, limit: 1) { paid_at }
          }
        }
        customer {
          invoices(where: {payment_status: {_eq: "paid"}}) {
            id invoice_date due_date payments(order_by: {paid_at: asc}, limit: 1) { paid_at }
          }
        }
      }
    }
    """
    data = await _gql(query, {"companyId": company_id})
    records = []
    for inv in data["invoices"]:
        if not inv["payments"]:
            continue
        paid_at = date.fromisoformat(inv["payments"][0]["paid_at"][:10])
        due = date.fromisoformat(inv["due_date"][:10])
        inv_date = date.fromisoformat(inv["invoice_date"][:10])
        is_receivable = bool(inv.get("customer"))
        party = inv.get("customer") or inv.get("vendor") or {"invoices": []}
        # Exclude this invoice from its own history (the outer + nested queries
        # use the same filter, so `inv` always appears inside its own party's
        # list) and only count invoices dated strictly before this one — a
        # "prior on-time rate" computed from invoices that hadn't happened yet
        # (or from the row's own outcome) is leaking the label into the feature.
        settled = [
            h
            for h in party["invoices"]
            if h["id"] != inv["id"]
            and h["payments"]
            and h["due_date"]
            and date.fromisoformat(h["invoice_date"][:10]) < inv_date
        ]
        on_time = sum(
            1
            for h in settled
            if date.fromisoformat(h["payments"][0]["paid_at"][:10])
            <= date.fromisoformat(h["due_date"][:10])
        )
        rate = on_time / len(settled) if settled else 0.7
        records.append(
            {
                "vendor_ontime_rate": rate,
                "amount": float(inv["amount"]),
                "department": inv["department"],
                "approval_chain_length": inv["approvals_aggregate"]["aggregate"]["count"],
                "invoice_day_of_month": inv_date.day,
                "tax_amount": float(inv["tax_amount"] or 0),
                "po_matched": 1 if inv["po_id"] else 0,
                "is_receivable": 1 if is_receivable else 0,
                "paid_late": 1 if paid_at > due else 0,
                "delay_days": max(0, (paid_at - due).days),
            }
        )
    if len(records) < 50:
        raise SystemExit(
            f"only {len(records)} paid invoices in Hasura — too few to train. "
            "Run without --from-hasura to use synthetic data."
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


def train(source: str = "synthetic", company_id: str | None = None) -> dict:
    """Train the delay classifier + regressor from `source` ("synthetic" or
    "hasura") and serialise to MODEL_PATH (source="synthetic", no company_id —
    the shared bootstrap the Dockerfile builds at image time) or to that
    company's own model path (source="hasura", company_id set — a real
    per-tenant retrain). Returns the metrics dict. Raises SystemExit if
    `source == "hasura"` and there isn't enough of that company's own real
    paid-invoice data yet — callers (e.g. app/retrain.py) should catch that."""
    if source == "hasura":
        if not company_id:
            raise ValueError("company_id is required when source='hasura'")
        df = asyncio.run(_load_from_hasura(company_id))
        out_path = company_model_path(company_id, MODEL_PATH)
    else:
        if not SYNTHETIC_CSV.exists():
            raise SystemExit("run  python -m ml.generate_synthetic_training_data  first")
        df = pd.read_csv(SYNTHETIC_CSV)
        out_path = MODEL_PATH

    x = _rows_to_matrix(df)
    y_cls = df["paid_late"].to_numpy(dtype=int)
    y_reg = df["delay_days"].to_numpy(dtype=float)

    xtr, xte, ytr_c, yte_c, ytr_r, yte_r = train_test_split(
        x, y_cls, y_reg, test_size=0.2, random_state=42, stratify=y_cls
    )

    clf = XGBClassifier(
        n_estimators=200, max_depth=4, learning_rate=0.08, subsample=0.9,
        eval_metric="logloss", tree_method="hist", early_stopping_rounds=20,
    )
    clf.fit(xtr, ytr_c, eval_set=[(xte, yte_c)], verbose=False)
    reg = XGBRegressor(
        n_estimators=250, max_depth=4, learning_rate=0.08, subsample=0.9, tree_method="hist",
        early_stopping_rounds=20,
    )
    reg.fit(xtr, ytr_r, eval_set=[(xte, yte_r)], verbose=False)

    proba = clf.predict_proba(xte)[:, 1]
    pred = (proba >= 0.5).astype(int)
    auc = roc_auc_score(yte_c, proba)
    accuracy = accuracy_score(yte_c, pred)
    precision = precision_score(yte_c, pred, zero_division=0)
    recall = recall_score(yte_c, pred, zero_division=0)
    reg_pred = reg.predict(xte).clip(min=0)
    mae = mean_absolute_error(yte_r, reg_pred)
    r2 = r2_score(yte_r, reg_pred)
    stopped_at = f"clf {clf.best_iteration + 1}/200, reg {reg.best_iteration + 1}/250"
    version = f"xgb-{date.today():%Y%m%d}-{source}-{len(df)}"
    metrics = {
        "roc_auc": round(float(auc), 4),
        "accuracy": round(float(accuracy), 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "mae_days": round(float(mae), 2),
        "r2": round(float(r2), 4),
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as fh:
        pickle.dump(
            {
                "clf": clf,
                "reg": reg,
                "feature_names": FEATURE_NAMES,
                "version": version,
                "trained_at": datetime.now(timezone.utc).isoformat(),
                "n_rows": int(len(df)),
                "metrics": metrics,
                "baseline_stats": _baseline_stats(x, FEATURE_NAMES),
            },
            fh,
        )
    print(
        f"trained on {len(df)} {source} rows | ROC-AUC {auc:.3f} | accuracy {accuracy:.3f} | "
        f"precision {precision:.3f} | recall {recall:.3f} | MAE {mae:.1f}d | R2 {r2:.3f} | "
        f"stopped: {stopped_at}"
    )
    print(f"saved {version} -> {out_path}")
    return {"version": version, "metrics": metrics, "n_rows": int(len(df))}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-hasura", action="store_true")
    ap.add_argument("--company-id", default=None, help="required with --from-hasura")
    args = ap.parse_args()
    if args.from_hasura:
        train("hasura", company_id=args.company_id)
    else:
        train("synthetic")


if __name__ == "__main__":
    main()
