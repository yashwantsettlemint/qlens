# Production readiness

Status as of the security/infra hardening pass on this branch. Not a
substitute for a real audit — a working list of what's covered and what
isn't, so "is this production ready?" has a written answer instead of a
guess.

## Done

- **Real OIDC IdP (Keycloak)** — `auth-service` no longer stores or checks
  passwords; Keycloak does. Login is a browser redirect (Authorization Code +
  PKCE via NextAuth) to Keycloak's own hosted page — verified end-to-end
  against a live Keycloak instance, including the PKCE code-challenge
  redirect and the resulting Keycloak login page actually rendering.
  Register/invite-accept remain this app's own forms (company/role
  provisioning Keycloak can't do) and now also create the matching Keycloak
  account (`services/auth-service/app/keycloak_admin.py`) — verified live:
  registering creates both the Postgres row and a real, enabled Keycloak
  user with the submitted password. See `infra/keycloak/realm-export.json`,
  `apps/web/auth.ts`.
- **No more admin-secret writes from the web BFF** — every table the BFF
  used to write via `{admin: true}` now has a real per-role Hasura
  permission (`company_admin` alongside `finance_user`/`approver`, plus
  narrow dedicated roles `payments_webhook`/`public_lead` for the two
  genuinely sessionless paths: the Razorpay webhook and the anonymous demo
  request form). Verified live: Hasura reports the full metadata bundle as
  consistent (`get_inconsistent_metadata` → `is_consistent: true`), and the
  admin secret is no longer read anywhere in `apps/web/server/resolvers.ts`.
  Caught and fixed a real pre-existing bug along the way:
  `/api/payments/create-link` had no tenant-ownership check on the invoice
  it looked up — Hasura's own per-role select filter now closes that.
- **Service-to-service auth**: ingestion/ml/genai/notification/ocr-service
  all require `X-Internal-Token` on every non-health route (fails closed if
  unset). See `packages/shared-types/shared_types/auth.py`.
- **Least-privilege Hasura access**: every service mints its own scoped JWT
  role (`ml_service`, `notifier`, `ocr_service`, `genai_writer`,
  `finance_user`) instead of using the Hasura admin secret. Verified live
  against a running Hasura instance, not just reviewed. See
  `hasura/metadata/databases/*/tables/*.yaml`.
- **Auth hardening**: Keycloak's own brute-force detection
  (`infra/keycloak/realm-export.json`) replaces the old bespoke lockout
  columns; `slowapi` rate-limits `auth-service`'s remaining
  account-creation endpoints (`/register`, `/invites/accept`, 5/minute/IP —
  those have no built-in protection of their own).
- **CORS**: `auth-service` denies cross-origin requests by default instead
  of falling back to `*`.
- **Structured logging**: every Python service now calls
  `shared_types.logging.configure_logging()` at startup (stdlib, JSON
  output) instead of an inconsistent per-module `logging.basicConfig`.
- **Secrets safety net**: every Python service and the web BFF refuse to
  boot with a known dev-default secret (`devsecret`, `dev-jwt-signing-key…`,
  etc.) when `ENV=production`/`REQUIRE_AUTH=1`. See
  `packages/shared-types/shared_types/secrets_check.py`,
  `apps/web/server/hasura.ts`.
- **CI dependency scanning**: `pip-audit --skip-editable` and
  `npm audit --omit=dev --audit-level=high` run on every push.
- **Hasura prod config**: dev mode / console disabled via
  `infra/k8s/configmap.yaml` (still on in `infra/docker-compose.yml` for
  local dev, intentionally).
- **Kubernetes manifests**: `infra/k8s/` — namespace, configmap, secrets
  template, per-service Deployments/Services, Keycloak, a Postgres backup
  CronJob, and an Ingress that exposes only the web BFF and Keycloak
  (everything else is ClusterIP-only).
- **Containerized frontend**: `apps/web/Dockerfile`.
- **CI**: `.github/workflows/ci.yml` builds every service + web Docker
  image on every push (build-only, no registry push yet).
- **Dependencies**: `apps/web` upgraded Next.js 14 → 16 (React 18 → 19),
  clearing all critical/high `npm audit` advisories tied to Next.js/postcss.

## Not done — real gaps before real traffic

1. **Nothing is deployed.** `infra/k8s/secrets.yaml` doesn't exist yet
   (copy from `secrets.example.yaml` and fill in real values) — no cluster,
   registry, domain, or TLS cert is provisioned.
2. **No metrics/error-tracking/alerting** — structured JSON logs now exist
   (see above), but nothing aggregates or alerts on them yet.
3. **Postgres backups exist but are unverified in production** — a nightly
   CronJob (`infra/k8s/postgres-backup-cronjob.yaml`) now runs `pg_dump` to
   a PVC; restore has not been tested against a real cluster, and there's no
   offsite/S3 copy yet.
4. **No redundancy**: Postgres/RabbitMQ/every service (including Keycloak)
   run at 1 replica by design; no autoscaling, no multi-AZ.
5. **No CD pipeline** — every deploy is a manual `kubectl apply`.
6. **Payments are in test mode** (`RAZORPAY_KEY_ID`/`SECRET` are
   `rzp_test_...`); webhook signature verification not audited this pass.
7. **`/extract-ocr` still handles PDF text layers only** — scanned/image
   documents return `pending_review`; wiring a vision provider is the one
   deliberately deferred item from this pass.
8. **LLM key is a personal Groq free-tier key** — not sized for real
   concurrent usage.
9. **No load testing, no integration/e2e tests** — only unit-level tests
   per service. The Keycloak OIDC callback (code exchange → session cookie)
   was verified live up through the PKCE redirect to Keycloak's hosted login
   page; the final leg (submitting credentials through Keycloak's own form
   and completing the callback) still needs a real browser pass.

Items 1, 2, and 6 are the minimum before this should see real users and
real money.
