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
from sklearn.metrics import mean_absolute_error, roc_auc_score
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier, XGBRegressor

from app.config import MODEL_PATH, SYNTHETIC_CSV
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
        )
        out.append([feats[n] for n in FEATURE_NAMES])
    return np.array(out, dtype=float)


async def _load_from_hasura() -> pd.DataFrame:
    from app.hasura import _gql  # reuse the admin client

    query = """
    {
      invoices(where: {payment_status: {_eq: "paid"}}) {
        amount tax_amount department po_id invoice_date due_date
        approvals_aggregate { aggregate { count } }
        payments(order_by: {paid_at: asc}, limit: 1) { paid_at }
        vendor {
          invoices(where: {payment_status: {_eq: "paid"}}) {
            due_date payments(order_by: {paid_at: asc}, limit: 1) { paid_at }
          }
        }
      }
    }
    """
    data = await _gql(query, {})
    records = []
    for inv in data["invoices"]:
        if not inv["payments"]:
            continue
        paid_at = date.fromisoformat(inv["payments"][0]["paid_at"][:10])
        due = date.fromisoformat(inv["due_date"][:10])
        inv_date = date.fromisoformat(inv["invoice_date"][:10])
        settled = [h for h in inv["vendor"]["invoices"] if h["payments"] and h["due_date"]]
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-hasura", action="store_true")
    args = ap.parse_args()

    if args.from_hasura:
        df = asyncio.run(_load_from_hasura())
        source = "hasura"
    else:
        if not SYNTHETIC_CSV.exists():
            raise SystemExit("run  python -m ml.generate_synthetic_training_data  first")
        df = pd.read_csv(SYNTHETIC_CSV)
        source = "synthetic"

    x = _rows_to_matrix(df)
    y_cls = df["paid_late"].to_numpy(dtype=int)
    y_reg = df["delay_days"].to_numpy(dtype=float)

    xtr, xte, ytr_c, yte_c, ytr_r, yte_r = train_test_split(
        x, y_cls, y_reg, test_size=0.2, random_state=42, stratify=y_cls
    )

    clf = XGBClassifier(
        n_estimators=200, max_depth=4, learning_rate=0.08, subsample=0.9,
        eval_metric="logloss", tree_method="hist",
    )
    clf.fit(xtr, ytr_c)
    reg = XGBRegressor(
        n_estimators=250, max_depth=4, learning_rate=0.08, subsample=0.9, tree_method="hist",
    )
    reg.fit(xtr, ytr_r)

    auc = roc_auc_score(yte_c, clf.predict_proba(xte)[:, 1])
    mae = mean_absolute_error(yte_r, reg.predict(xte).clip(min=0))
    version = f"xgb-{date.today():%Y%m%d}-{source}-{len(df)}"

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(MODEL_PATH, "wb") as fh:
        pickle.dump(
            {
                "clf": clf,
                "reg": reg,
                "feature_names": FEATURE_NAMES,
                "version": version,
                "trained_at": datetime.now(timezone.utc).isoformat(),
                "n_rows": int(len(df)),
                "metrics": {"roc_auc": round(float(auc), 4), "mae_days": round(float(mae), 2)},
            },
            fh,
        )
    print(f"trained on {len(df)} {source} rows | ROC-AUC {auc:.3f} | MAE {mae:.1f}d")
    print(f"saved {version} -> {MODEL_PATH}")


if __name__ == "__main__":
    main()
