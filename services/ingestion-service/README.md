# ingestion-service

CSV / manual invoice ingestion. Validates rows, then commits through Hasura's GraphQL API
as `finance_user` in one batched `insert_invoices` — so ingested invoices take the same
path (permissions + `invoice_ml_score` event trigger) as anything else.

Plain `csv` module, no pandas.

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/upload/csv` | multipart `file` (.csv) | `{summary, rows:[{row, valid, errors, data}]}` — no commit |
| POST | `/upload/csv/commit` | `{rows: [<csv-shaped row>...], created_by}` | `{committed, invoices:[{id, invoice_number}]}` (422 if any row invalid — nothing commits) |
| POST | `/upload/manual` | one invoice (see `ManualInvoice`) | `{committed, invoice}` |
| GET | `/health` | — | `{status:"ok"}` |

CSV columns (header case / spacing / common synonyms tolerated):
`invoice_number, vendor, department, invoice_date, due_date, amount, tax_amount, source, po_number`
`vendor` is a **name**, resolved to an id against Hasura; `po_number` optional.

Validation (human-readable messages, per row): required fields present, vendor resolves,
`po_number` resolves if given, `department` in the known set, dates are `YYYY-MM-DD`,
`due_date >= invoice_date`, `amount`/`tax_amount` numeric and not negative, `source` in
`manual|csv|ocr`.

## Config (env)

| Var | Default |
|---|---|
| `HASURA_ENDPOINT` | `http://localhost:8088/v1/graphql` |
| `HASURA_ADMIN_SECRET` | `devsecret` |

(Falls back to `HASURA_GRAPHQL_ENDPOINT` / `HASURA_GRAPHQL_ADMIN_SECRET`.)

## Run locally

```bash
python -m venv .venv && . .venv/Scripts/activate      # or .venv/bin/activate
pip install -e ../../packages/shared-types -e .
uvicorn app.main:app --reload --port 8091
python tests/test_validation.py                       # the runnable check
```

## Run in the stack

Active in `infra/docker-compose.yml`. Container listens on 8001; published on host
**8091** (this machine already uses 8001). Build context is the repo root.
```bash
docker compose -f infra/docker-compose.yml up -d ingestion-service
curl http://localhost:8091/health
```
