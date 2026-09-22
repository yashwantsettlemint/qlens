"""Synthetic labelled invoice pairs so the duplicate classifier can be trained
and demoed before real reviewed flags exist.

    python -m ml.generate_synthetic_duplicate_pairs --rows 5000

Writes data/synthetic_duplicate_pairs.csv with raw a_*/b_* columns (train.py runs
the same pair_features funnel as serving) plus the label `is_duplicate`.

Positives: a near-copy of an invoice (rounding jitter, a few days off, an
OCR-style typo in the number). Negatives: a *different* real invoice from the
same party — including the hard ones: the next number in the sequence, or a
recurring charge at the same amount a month later.
"""

from __future__ import annotations

import argparse
import csv

import numpy as np

from app.config import DEPARTMENTS, SYNTHETIC_DUP_CSV

COLUMNS = [
    "a_invoice_number", "a_amount", "a_tax_amount", "a_po_id", "a_invoice_date", "a_department",
    "b_invoice_number", "b_amount", "b_tax_amount", "b_po_id", "b_invoice_date", "b_department",
    "is_duplicate",
]

_OCR_SWAPS = {"0": "O", "O": "0", "1": "I", "I": "1", "5": "S", "S": "5", "8": "B", "B": "8"}
_PREFIXES = ["INV", "ACME", "HAVL", "GLBX", "TCS", "BILL", "AR"]


def _iso(rng, start_ord: int, spread: int) -> str:
    from datetime import date, timedelta

    return (date.fromordinal(start_ord) + timedelta(days=int(rng.integers(0, spread)))).isoformat()


def _invoice_no(rng) -> str:
    p = rng.choice(_PREFIXES)
    return f"{p}/26-27/{int(rng.integers(1, 9999)):04d}"


def _next_in_sequence(num: str, rng) -> str:
    head, _, tail = num.rpartition("/")
    try:
        n = int(tail) + int(rng.integers(1, 4))
        return f"{head}/{n:04d}"
    except ValueError:
        return _invoice_no(rng)


def _typo(num: str, rng) -> str:
    chars = list(num)
    for _ in range(int(rng.integers(1, 3))):
        i = int(rng.integers(0, len(chars)))
        kind = rng.random()
        if kind < 0.5 and chars[i] in _OCR_SWAPS:
            chars[i] = _OCR_SWAPS[chars[i]]
        elif kind < 0.8 and i + 1 < len(chars):
            chars[i], chars[i + 1] = chars[i + 1], chars[i]
        elif len(chars) > 4:
            chars.pop(i)
    return "".join(chars)


def _base(rng, base_ord: int) -> dict:
    amount = round(float(rng.lognormal(11.6, 0.9)), 2)
    return {
        "invoice_number": _invoice_no(rng),
        "amount": amount,
        "tax_amount": round(amount * float(np.clip(rng.normal(0.18, 0.015), 0.05, 0.28)), 2),
        "po_id": f"po-{int(rng.integers(1, 400))}" if rng.random() < 0.6 else "",
        "invoice_date": _iso(rng, base_ord, 1),
        "department": str(rng.choice(DEPARTMENTS)),
    }


def _positive(a: dict, rng, base_ord: int) -> dict:
    """A genuine re-entry of the same invoice. `messy` positives keep only *some*
    of the signals — a big date gap, or a mangled number — so the model can't
    lean on all three at once (that's just the rule gates)."""
    b = dict(a)
    messy = rng.random() < 0.3
    if rng.random() < (0.7 if messy else 0.4):        # amount jitter
        sd = 0.02 if messy else 0.002
        factor = 1.0 + float(rng.normal(0, sd))
        b["amount"] = round(a["amount"] * factor, 2)
        b["tax_amount"] = round(a["tax_amount"] * factor, 2)
    b["invoice_date"] = _iso(rng, base_ord, 45 if messy else 8)
    nr = rng.random()
    if messy or nr < 0.4:
        b["invoice_number"] = _typo(a["invoice_number"], rng)
        if messy:
            b["invoice_number"] = _typo(b["invoice_number"], rng)
    elif nr < 0.55:
        b["invoice_number"] = a["invoice_number"].replace("/", "-").lower()
    if messy and rng.random() < 0.5:
        b["po_id"] = ""                                # PO wasn't captured the 2nd time
    return b


def _negative(a: dict, rng, base_ord: int) -> dict:
    """A *different* real invoice from the same party. `r < 0.2` is the hard
    case: same amount, same PO, one digit off, a day or two apart — two
    legitimate invoices that a naive rule would flag."""
    b = _base(rng, base_ord)
    b["department"] = a["department"] if rng.random() < 0.75 else b["department"]
    r = rng.random()
    if r < 0.2:                        # deceptively close, but genuinely distinct
        b["invoice_number"] = _next_in_sequence(a["invoice_number"], rng)
        b["amount"] = a["amount"]
        b["tax_amount"] = a["tax_amount"]
        b["po_id"] = a["po_id"]
        b["invoice_date"] = _iso(rng, base_ord + int(rng.integers(1, 4)), 2)
    elif r < 0.45:                     # next invoice in the sequence
        b["invoice_number"] = _next_in_sequence(a["invoice_number"], rng)
        b["invoice_date"] = _iso(rng, base_ord + int(rng.integers(2, 40)), 5)
    elif r < 0.62:                     # recurring charge, same amount, a month on
        b["amount"] = a["amount"]
        b["tax_amount"] = a["tax_amount"]
        b["invoice_date"] = _iso(rng, base_ord + int(rng.integers(25, 45)), 5)
    else:                             # unrelated invoice, spread over the year
        b["invoice_date"] = _iso(rng, base_ord + int(rng.integers(0, 300)), 10)
    if rng.random() < 0.3:
        b["po_id"] = a["po_id"]
    return b


def generate(n: int, seed: int = 20260910) -> list[dict]:
    from datetime import date

    rng = np.random.default_rng(seed)
    base_ord = date(2026, 1, 1).toordinal()
    rows: list[dict] = []
    while len(rows) < n:
        a = _base(rng, base_ord + int(rng.integers(0, 320)))
        is_pos = len(rows) % 2 == 0
        b = _positive(a, rng, base_ord) if is_pos else _negative(a, rng, base_ord)
        label = 1 if is_pos else 0
        if rng.random() < 0.04:        # reviewers mislabel a few, too
            label ^= 1
        rows.append(
            {
                **{f"a_{k}": v for k, v in a.items()},
                **{f"b_{k}": v for k, v in b.items()},
                "is_duplicate": label,
            }
        )
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", type=int, default=5000)
    ap.add_argument("--seed", type=int, default=20260910)
    args = ap.parse_args()

    rows = generate(args.rows, args.seed)
    SYNTHETIC_DUP_CSV.parent.mkdir(parents=True, exist_ok=True)
    with open(SYNTHETIC_DUP_CSV, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    pos = sum(r["is_duplicate"] for r in rows)
    print(f"wrote {len(rows)} pairs -> {SYNTHETIC_DUP_CSV}  ({pos} duplicates, {pos / len(rows):.0%})")


if __name__ == "__main__":
    main()
