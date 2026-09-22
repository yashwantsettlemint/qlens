# ml-service

Two models over invoices. **There is no fallback** — if the trained `.pkl` is
missing or unloadable, `/score` and `/check-duplicate` return **503**
(`ModelUnavailable`) rather than a heuristic or rule-based guess.

| Model | Task | Type | Trained artifact | Missing artifact |
|---|---|---|---|---|
| **Delay predictor** | Will this invoice be paid late, and by how many days? | `XGBClassifier` + `XGBRegressor` | `models/delay_model.pkl` | `503 ModelUnavailable` |
| **Duplicate classifier** | Is this invoice a re-entry of an existing one? | `XGBClassifier` over pairwise features | `models/duplicate_model.pkl` | `503 ModelUnavailable` |

Both `.pkl` files are gitignored. The Docker image trains both at build time
(`Dockerfile`), so a fresh `docker compose up` always has them. Running the
service outside Docker requires training first (see [Commands](#commands)).

---

## HTTP surface

| Method | Path | Caller | Does |
|---|---|---|---|
| POST | `/score` | Hasura **event trigger** `invoice_ml_score` (invoices INSERT / UPDATE of a feature column) | runs both models, writes `duplicate_flags` + `delay_predictions` back, returns what it wrote |
| POST | `/check-duplicate` | Hasura **action** `checkDuplicateSync` (synchronous, pre-insert, from the upload flow) | duplicate check only, **no write** |
| GET | `/health` | compose healthcheck | `{"status": "ok"}` |

Host port **8092**, container **8002**.

---

## File map

```
app/                         the running service (serve time)
  __init__.py                ModelUnavailable — raised when a required .pkl is missing/unloadable
  main.py                    FastAPI routes; /score orchestration; maps ModelUnavailable -> 503
  duplicates.py              detect() -> _detect_ml; _load_model() raises ModelUnavailable if the .pkl is absent
  dup_features.py            pair_features() — the 13 pairwise features; ONE funnel for train + serve
  delay.py                   predict_delay() / predict_from_features(); _load_model() raises if the .pkl is absent
  features.py                assemble_features() — the delay features; ONE funnel for train + serve
  config.py                  paths + Hasura creds
  hasura.py                  reads context (party siblings + paid history), writes flags/predictions as admin

ml/                          offline training + data generation (build time / ad-hoc)
  generate_synthetic_training_data.py    -> data/synthetic_invoices.csv       (delay labels)
  train.py                               -> models/delay_model.pkl
  generate_synthetic_duplicate_pairs.py  -> data/synthetic_duplicate_pairs.csv (pair labels)
  train_duplicates.py                    -> models/duplicate_model.pkl
  predict.py                             one-off delay prediction from the CLI (same code path as /score)

tests/
  test_duplicates.py         delay feature funnel + model-backed predict + ModelUnavailable when absent
  test_dup_features.py       pairwise features + detect() routing through a fake model + ModelUnavailable when absent

Dockerfile                   installs shared-types + this service, then trains BOTH models at build time
pyproject.toml               deps: fastapi, uvicorn, httpx, rapidfuzz, numpy, pandas, scikit-learn, xgboost
```

`DEPARTMENTS` (the one-hot vocabulary) lives in `packages/shared-types`, not here.
The `DUPLICATE_*` rule constants there are unused now that detection is ML-only.

---

## No train/serve skew — the "one funnel" rule

Each model has exactly one function that turns raw fields into a feature vector,
and both the trainer and the server call it:

- **delay** → `app/features.py::assemble_features(...)` → ordered by `FEATURE_NAMES`
- **duplicate** → `app/dup_features.py::pair_features(cand, other)` → ordered by `DUP_FEATURE_NAMES`

`FEATURE_NAMES` / `DUP_FEATURE_NAMES` are also pickled into the model, and serve
time reindexes by the model's own list — so a feature reorder or rename can't
silently misalign the vector.

---

## Model 1 — delay predictor

### Features (`assemble_features`)

| Feature | Source |
|---|---|
| `vendor_ontime_rate` | fraction of the party's prior **paid** invoices settled on/before due date; unknown party → `0.7` prior (`vendor_ontime_rate()` in `features.py`) |
| `amount_log` | `log1p(amount)` |
| `approval_chain_length` | count of `approvals` rows |
| `day_of_month` | day component of `invoice_date` |
| `tax_fraction` | `tax_amount / amount` |
| `po_matched` | 1 if `po_id` present |
| `dept_<D>` | one-hot over `DEPARTMENTS` (6 columns) |

### Serving (`app/delay.py`)

`predict_delay(invoice, party_paid_history)`:
1. `assemble_features(...)`.
2. `_load_model()` — `@lru_cache(maxsize=1)`, reads `models/delay_model.pkl` once.
   **Missing file → `ModelUnavailable`** (`lru_cache` doesn't cache the raise, so a
   model dropped in later is picked up on the next call).
3. `clf.predict_proba(x)[0,1]` → `delay_probability`;
   `reg.predict(x)[0]` (clipped ≥ 0) → `predicted_delay_days`;
   `model_version` from the pickle (e.g. `xgb-20260910-synthetic-3000`).

### Training (`ml/train.py`)

- **Synthetic (default):** `ml/generate_synthetic_training_data.py` builds a latent
  late-propensity from on-time rate, month-end, missing PO, amount + noise → sigmoid
  → Bernoulli label `paid_late`; `delay_days` from a Poisson scaled by that
  probability. Writes `data/synthetic_invoices.csv` (raw columns, not vectors).
- **Real:** `python -m ml.train --from-hasura` pulls `payment_status = "paid"`
  invoices via GraphQL (admin), derives the party's on-time rate from *their* paid
  history, labels `paid_late` / `delay_days` from first payment vs due date.
  Refuses with < 50 rows.
- Both paths: `_rows_to_matrix` runs `assemble_features` per row → 80/20
  `train_test_split` stratified on `paid_late` → fit `XGBClassifier`
  (200 trees, depth 4, lr 0.08) and `XGBRegressor` (250 trees) → report
  **ROC-AUC** (classifier) and **MAE days** (regressor) on the held-out 20%.
- Pickle payload: `{clf, reg, feature_names, version, trained_at, n_rows, metrics}`.

### Consumed by

`/score` writes a `delay_predictions` row (delete-then-insert, one current row per
invoice). The frontend colours a green/amber/red dot at `delayProbability`
thresholds `0.34 / 0.67` (`apps/web/lib/risk.ts`) and renders a plain-language
note (`riskNote`).

---

## Model 2 — duplicate classifier

### Pairwise features (`pair_features(cand, other)` → `DUP_FEATURE_NAMES`, 13)

amount: `amount_rel_gap`, `amount_exact`, `tax_rel_gap` ·
date: `day_gap`, `same_month` ·
number: `num_ratio`, `num_partial`, `num_token_sort`, `num_len_diff`, `num_exact`
(all via `rapidfuzz`) ·
PO / dept: `same_po`, `both_have_po`, `dept_match`.

A "pair" is (candidate invoice, one sibling of the **same party** — the vendor for
a payable, the customer for a receivable).

### Serving (`app/duplicates.py::detect`)

`_load_model()` (cached) → `_detect_ml`: build a feature row per sibling,
`clf.predict_proba`, take the arg-max; if `p ≥ threshold` (from the pickle,
default 0.5) return a `DuplicateMatch(method="ml")` with a human-readable `reason`
assembled from the winning feature row, else `None`.

**Missing file → `ModelUnavailable`.** An unloadable/incompatible pickle is **not**
caught — the underlying error propagates and `main.py` turns it into a 503. No
rule-based fallback.

### Training (`ml/train_duplicates.py`)

- **Synthetic (default):** `ml/generate_synthetic_duplicate_pairs.py` — positives
  are near-copies (rounding jitter, a few days off, OCR-style typos in the number;
  30% "messy" positives keep only *some* signals so the model can't just relearn
  the rule gate); negatives are genuinely distinct same-party invoices including
  the hard cases (next number in sequence, recurring charge same amount a month
  later). 4% label noise. Writes `data/synthetic_duplicate_pairs.csv`.
- **Real:** `python -m ml.train_duplicates --from-hasura` reads human-reviewed
  `duplicate_flags`: `reviewed_status = "confirmed_duplicate"` → 1,
  `"false_positive"` → 0, `unreviewed` skipped. Refuses with < 40 rows or a single
  class.
- `_matrix` runs `pair_features` per row → 80/20 stratified split → fit
  `XGBClassifier` (same hyperparams as delay) → report ROC-AUC.
- Pickle payload: `{clf, feature_names, version, threshold, trained_at, n_rows, metrics}`.
  Threshold leans low on purpose (`--threshold`, default 0.5): a missed duplicate
  is costly, a false flag is cheap to dismiss.

### Consumed by

`/score` writes/clears a `duplicate_flags` row (`reviewed_status = "unreviewed"`);
it deletes prior **unreviewed** rows for the invoice before inserting, so a
human's confirm/clear decision isn't wiped by a re-score.
`/check-duplicate` returns the verdict inline for the pre-insert upload check.
Reviewers confirm/clear flags in the invoice detail UI; those decisions become the
labels for the next `--from-hasura` retrain.

---

## The lifecycle, and where each step lives

| Step | Delay | Duplicate |
|---|---|---|
| **1. Data** | `ml/generate_synthetic_training_data.py` → `data/synthetic_invoices.csv`; or live `paid` invoices via `--from-hasura` | `ml/generate_synthetic_duplicate_pairs.py` → `data/synthetic_duplicate_pairs.csv`; or reviewed `duplicate_flags` via `--from-hasura` |
| **2. Features** | `app/features.py::assemble_features` (shared with serving) | `app/dup_features.py::pair_features` (shared with serving) |
| **3. Train + split + metrics** | `ml/train.py` — stratified 80/20, XGB clf+reg, ROC-AUC + MAE | `ml/train_duplicates.py` — stratified 80/20, XGB clf, ROC-AUC |
| **4. Serialize** | `pickle` → `models/delay_model.pkl` (+ `feature_names`, `version`, `metrics`) | `pickle` → `models/duplicate_model.pkl` (+ `threshold`) |
| **5. Package** | `Dockerfile` runs steps 1+3 at image build (`--rows 3000`) | same, `--rows 6000` |
| **6. Load** | `app/delay.py::_load_model` — `lru_cache(1)`, lazy, on first `/score` | `app/duplicates.py::_load_model` — same |
| **7. Serve** | `POST /score` → `predict_delay` → write `delay_predictions` | `POST /score` and `POST /check-duplicate` → `detect` → write/return `duplicate_flags` |
| **8. No model** | `_load_model` raises `ModelUnavailable` → `main.py` → **503** | same |
| **9. Consume** | `apps/web/lib/risk.ts` — colour dot + note | invoice detail — duplicate callout, confirm/clear |
| **10. Feedback loop** | mark invoices paid → richer on-time history → `train.py --from-hasura` | reviewers confirm/clear flags → `train_duplicates.py --from-hasura` |
| **11. Re-deploy** | retrain → drop the new `.pkl` in `services/ml-service/models/` (compose bind-mounts it over the image copy) → `docker compose restart ml-service` (no rebuild) | same |

There is **no versioned model registry, no A/B, no drift monitor, no scheduled
retrain, and no fallback** — retraining is a manual command, the "version" is just
a dated string in the pickle, and a missing model is a hard 503. That's the
deliberate ceiling for a demo build; the seams (`detect()`, `_load_model()`, the
pickled `feature_names`) are where a real pipeline would slot in.

---

## Commands

```bash
# delay
python -m ml.generate_synthetic_training_data --rows 3000
python -m ml.train                    # -> models/delay_model.pkl
python -m ml.train --from-hasura      # train on real paid invoices
python -m ml.predict '{"amount":250000,"tax_amount":45000,"department":"IT","invoice_date":"2026-09-28","po_id":null}' --vendor-ontime 0.5

# duplicate
python -m ml.generate_synthetic_duplicate_pairs --rows 6000
python -m ml.train_duplicates                  # -> models/duplicate_model.pkl
python -m ml.train_duplicates --from-hasura    # train on reviewed flags

# run + test  (train both models first — the service 503s without them)
pip install -e ../../packages/shared-types -e .
python tests/test_duplicates.py
python tests/test_dup_features.py
uvicorn app.main:app --port 8092
```

## Config

| Var | Default |
|---|---|
| `HASURA_ENDPOINT` | `http://localhost:8088/v1/graphql` |
| `HASURA_ADMIN_SECRET` | `devsecret` |
| `DELAY_MODEL_PATH` | `models/delay_model.pkl` |
| `DUPLICATE_MODEL_PATH` | `models/duplicate_model.pkl` |

(Lighter alternative if image size matters: `sklearn.ensemble.HistGradientBoosting*`
drops the `xgboost` dep. The brief asks for XGBoost, so that's what's here.)
