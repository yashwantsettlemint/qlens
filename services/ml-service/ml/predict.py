"""One-off delay prediction from the CLI (uses the same code path as /score).

    python -m ml.predict '{"amount": 250000, "tax_amount": 45000, "department": "IT",
                           "invoice_date": "2026-09-28", "po_id": null}'  \
        --vendor-ontime 0.55
"""

from __future__ import annotations

import argparse
import json

from app.delay import predict_delay


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("invoice", help="JSON: amount, tax_amount, department, invoice_date, po_id")
    ap.add_argument("--vendor-ontime", type=float, default=None,
                    help="override vendor on-time rate (0-1); else uses the neutral prior")
    args = ap.parse_args()

    inv = json.loads(args.invoice)
    history: list[dict] = []
    if args.vendor_ontime is not None:
        # fabricate a history that yields the requested rate
        n = 10
        good = round(args.vendor_ontime * n)
        history = [{"due_date": "2026-01-31", "paid_at": "2026-01-20"}] * good + [
            {"due_date": "2026-01-31", "paid_at": "2026-02-20"}
        ] * (n - good)

    print(json.dumps(predict_delay(inv, history), indent=2))


if __name__ == "__main__":
    main()
