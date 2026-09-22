"""Plausible synthetic invoice history so the delay model can be trained and
demoed before real paid-invoice data exists.

    python -m ml.generate_synthetic_training_data --rows 3000

Writes data/synthetic_invoices.csv with semi-raw columns (train.py runs the same
feature funnel as serving) plus the labels `paid_late` and `delay_days`.
"""

from __future__ import annotations

import argparse
import csv

import numpy as np

from app.config import DEPARTMENTS, SYNTHETIC_CSV

COLUMNS = [
    "vendor_ontime_rate",
    "amount",
    "department",
    "approval_chain_length",
    "invoice_day_of_month",
    "tax_amount",
    "po_matched",
    "is_receivable",
    "paid_late",
    "delay_days",
]


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def generate(n: int, seed: int = 20260907) -> list[dict]:
    rng = np.random.default_rng(seed)

    ontime = rng.beta(6, 3, n)                       # vendors skew reliable
    amount = np.round(rng.lognormal(11.6, 0.9, n), 2)  # ~₹1e5 median, long tail
    dept = rng.choice(DEPARTMENTS, n)
    chain = rng.integers(1, 4, n)
    dom = rng.integers(1, 29, n)
    tax = np.round(amount * rng.normal(0.18, 0.015, n).clip(0.05, 0.28), 2)
    po = rng.random(n) < 0.68
    # ~40% receivables (customers owing us) vs payables (us owing vendors).
    # Customers skew a bit slower to pay than we are to pay our own vendors —
    # the only reason this needs to be a feature at all.
    is_receivable = rng.random(n) < 0.4

    # latent late-propensity
    z = (
        -0.4
        + 2.6 * (1 - ontime)
        + 0.9 * (dom >= 25)
        + 0.7 * (~po)
        + 0.35 * (np.log1p(amount) - 11.6)
        + 0.5 * is_receivable
        + rng.normal(0, 0.5, n)
    )
    p_late = _sigmoid(z)
    paid_late = rng.random(n) < p_late
    delay_days = np.where(
        paid_late, rng.poisson(4 + 22 * p_late).clip(1, 90), 0
    ).astype(int)

    return [
        {
            "vendor_ontime_rate": round(float(ontime[i]), 4),
            "amount": float(amount[i]),
            "department": str(dept[i]),
            "approval_chain_length": int(chain[i]),
            "invoice_day_of_month": int(dom[i]),
            "tax_amount": float(tax[i]),
            "po_matched": int(bool(po[i])),
            "is_receivable": int(bool(is_receivable[i])),
            "paid_late": int(bool(paid_late[i])),
            "delay_days": int(delay_days[i]),
        }
        for i in range(n)
    ]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", type=int, default=3000)
    ap.add_argument("--seed", type=int, default=20260907)
    args = ap.parse_args()

    rows = generate(args.rows, args.seed)
    SYNTHETIC_CSV.parent.mkdir(parents=True, exist_ok=True)
    with open(SYNTHETIC_CSV, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    late = sum(r["paid_late"] for r in rows)
    print(f"wrote {len(rows)} rows -> {SYNTHETIC_CSV}  ({late} late, {late / len(rows):.0%})")


if __name__ == "__main__":
    main()
