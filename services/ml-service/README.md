# ml-service

Duplicate detection + delay prediction for invoices.

| Method | Path | Caller | Returns |
|---|---|---|---|
| POST | `/score` | Hasura **event trigger** `invoice_ml_score` (invoices INSERT/UPDATE) | runs both checks, writes `duplicate_flags` + `delay_predictions` back, returns what it wrote |
| POST | `/check-duplicate` | Hasura **action** `checkDuplicateSync` (synchronous, pre-insert) | `{isDuplicate, matchedInvoiceId, confidenceScore, method, reason}` |
| GET | `/health` | — | `{status:"ok"}` |

### Duplicate detection — rule-based (`app/duplicates.py`)
Same `vendor_id`, `amount` within 1%, invoice dates within 30 days, **and** (fuzzy
`invoice_number` ≥ 85 via `rapidfuzz` **or** same `po_id`). `detect()` is the seam — an
ML classifier returning `method="ml"` slots in without touching the endpoints. Tuning
constants live in `packages/shared-types`.

### Delay prediction — XGBoost (`app/delay.py`, `ml/`)
`XGBClassifier` (late probability) + `XGBRegressor` (days late). Features
(`app/features.py`, one funnel for train + serve): vendor historical on-time rate,
`log1p(amount)`, approval-chain length, day-of-month, tax fraction, PO-matched flag,
department one-hot.

```bash
python -m ml.generate_synthetic_training_data --rows 3000   # -> data/synthetic_invoices.csv
python -m ml.train                                          # -> models/delay_model.pkl
python -m ml.train --from-hasura                            # train on real paid invoices instead
python -m ml.predict '{"amount":250000,"tax_amount":45000,"department":"IT","invoice_date":"2026-09-28","po_id":null}' --vendor-ontime 0.5
```
No `models/delay_model.pkl` → `/score` falls back to a transparent heuristic
(`model_version = "heuristic-v0"`). The Docker image trains one at build time.

(Lighter alternative if the image size matters: `sklearn.ensemble.HistGradientBoosting*`
drops the `xgboost` dep. The brief asks for XGBoost, so that's what's here.)

## Config

| Var | Default |
|---|---|
| `HASURA_ENDPOINT` | `http://localhost:8088/v1/graphql` |
| `HASURA_ADMIN_SECRET` | `devsecret` |
| `DELAY_MODEL_PATH` | `models/delay_model.pkl` |

## Run

```bash
python -m venv .venv && . .venv/Scripts/activate
pip install -e ../../packages/shared-types -e .
python tests/test_duplicates.py
uvicorn app.main:app --port 8092
```
In the stack: host port **8092**, container 8002.
