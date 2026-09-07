# Invoice Processing & Vendor Payment Tracker

Monorepo.

```
apps/web/                  Next.js frontend (see apps/web/README.md)
hasura/                    Postgres migrations, Hasura metadata, seeds
infra/docker-compose.yml   full stack: postgres + hasura + seed + 5 FastAPI services
packages/shared-types/     Python enums/constants + Hasura JWT helper, shared across services
services/
  auth-service/            mock login -> Hasura-shaped JWTs (dev only)
  ingestion-service/       CSV / manual invoice ingestion -> Hasura as finance_user
  ml-service/              rule-based duplicate detection + XGBoost delay prediction
  genai-service/           LLM summaries / explanations, scoped to genai_readonly
  notification-service/    daily overdue sweep + digest
```

## Bring up the backend

```bash
cp infra/.env.example infra/.env
docker compose -f infra/docker-compose.yml up -d      # first run builds the images (ml-service trains a model at build time, ~3 min)
```

| Service | URL (host) | Notes |
|---|---|---|
| Postgres | `localhost:5433` | |
| Hasura | `http://localhost:8088` | console; `x-hasura-admin-secret: devsecret` |
| auth-service | `http://localhost:8095` | `POST /login` `{username,password}` |
| ingestion-service | `http://localhost:8091` | |
| ml-service | `http://localhost:8092` | `/score`, `/check-duplicate` |
| genai-service | `http://localhost:8093` | `/summarize`, `/explain-duplicate`, `/extract-ocr` |
| notification-service | `http://localhost:8094` | `/overdue-sweep` |

(Host ports are shifted off 5432/8080/8001-8004 to avoid clashes on this machine;
container-internal ports are the brief's 8001-8005.)

Migrations + metadata apply automatically (`cli-migrations-v3` image); the `seed` one-shot
then loads `hasura/seeds/default/` (truncate + reload, safe to re-run:
`docker compose up -d seed`). Tear down: `docker compose -f infra/docker-compose.yml down`
(`-v` also drops the DB volume).

## Hasura metadata

- All 8 tables + `vendor_exposure` view, tracked, with relationships
  (`invoices.vendor / .purchaseOrder / .duplicateFlag / .delayPrediction / .approvals / .payments`, …).
- Roles: `finance_user` (read all; insert/update invoices + payments), `approver`
  (read all; update only `status`/`acted_at` on their own `approvals` rows via
  `X-Hasura-User-Id`), `admin` (built-in), `genai_readonly` (select-only, and only on
  `invoices`, `vendors`, `duplicate_flags`, `delay_predictions`). No deletes for anyone.
- Event trigger `invoice_ml_score` on `invoices` INSERT + UPDATE of `amount|vendor_id|department`
  → `ML_SERVICE_SCORE_URL`, 3 retries (Hasura retries are fixed-interval, `interval_sec: 15`).
- Action `checkDuplicateSync(invoice) → DuplicateCheckResult` (synchronous) →
  `{{ML_SERVICE_URL}}/check-duplicate`, for `finance_user` + `admin`.
- Cron `overdue_sweep_daily` (02:00 UTC) → `{{NOTIFICATION_SERVICE_URL}}/overdue-sweep`.

## Auth (JWT)

`auth-service` signs HS256 tokens with `HASURA_GRAPHQL_JWT_SECRET` carrying the
`https://hasura.io/jwt/claims` block. Dev users: `kavya/kavya` (finance_user),
`priya.nair/priya` (approver), `anjali.rao/anjali` (admin), `genai-bot/genai`
(genai_readonly). `ml-service` / `notification-service` write as admin (service token);
`genai-service` self-mints a `genai_readonly` token (never the admin secret).

```bash
TOKEN=$(curl -s localhost:8095/login -d '{"username":"kavya","password":"kavya"}' -H 'content-type: application/json' | jq -r .access_token)
curl -s localhost:8088/v1/graphql -H "Authorization: Bearer $TOKEN" -d '{"query":"{ invoices(limit:1){invoice_number} }"}'
```

## Point the frontend at real Hasura

`apps/web/.env.local`:
```
NEXT_PUBLIC_HASURA_ENDPOINT=http://localhost:8088/v1/graphql
NEXT_PUBLIC_HASURA_JWT=<token from auth-service /login>   # or NEXT_PUBLIC_HASURA_ADMIN_SECRET=devsecret
```

**Gap:** `apps/web` still queries its own mock GraphQL surface
(`invoices(filter/sort/page)`, `dashboardStats`, `ask`), not what Hasura generates
(`invoices(where/order_by/limit/offset)`, `vendor_exposure`, …). Setting the endpoint
switches transport; the operations in `apps/web/graphql/operations/` need rewriting against
the Hasura schema. Frontend follow-up, not part of the backend brief.

## Status

| Area | State |
|---|---|
| `hasura/` migrations + metadata + seeds | **done** |
| `infra/docker-compose.yml` — full 8-service stack | **done** |
| `packages/shared-types/` (+ `shared_types.jwt`) | **done** |
| `services/auth-service` | **done** |
| `services/ingestion-service` | **done** |
| `services/ml-service` (+ synthetic-data / train / predict) | **done** |
| `services/genai-service` (Azure OpenAI + offline fallback) | **done** |
| `services/notification-service` | **done** |
| frontend operations rewritten for Hasura schema | not started |
