# Qlens — Invoice Processing & Vendor Payment Tracker

Internal AP tool frontend. Next.js (App Router) + TypeScript + Tailwind, Apollo Client.
Every operation goes through `/api/graphql` (a Next server route) to Hasura + genai-service.
See *Running against the real backend* below.

## Run it

```bash
npm install
npm run codegen      # generate typed GraphQL hooks (also runs automatically before build)
npm run dev          # http://localhost:3000
npm run test         # vitest — pure logic in lib/ and server/
npm run typecheck
```

`npm run build` runs `codegen` first (`prebuild`), then `next build`.

## Screens

| Route | What |
|---|---|
| `/` | Dashboard — pending / overdue / exposure stats, vendor-exposure bar chart (click a bar to filter), pending + overdue invoice tables |
| `/invoices` | Full invoice list — URL-synced filters (vendor, department, date range, approval, payment, source, search), server-style sort + pagination, row selection, bulk **approve** (role-gated) and **export selected to CSV** |
| `/invoices/[id]` | Invoice detail — header + status badges, duplicate callout (confirm / clear), delay-risk panel with plain-language note, approval timeline, record-payment form |
| `/vendors` | Vendor list — invoices, outstanding, avg delay, on-time % |
| `/vendors/[id]` | Vendor detail — dashboard stats scoped to the vendor + full invoice history |
| `/upload` | **Manual entry** form and **CSV upload** with a validated preview (per-row errors inline) before commit |
| Ask panel | Slide-over on every screen (top-bar **Ask**) — plain-language questions answered from current data, with a linked invoice table. Indigo accent, deliberately distinct from the data screens |

Sign in on `/login` (the app redirects there when there's no session). The role
(`finance_user` / `approver` / `admin`) comes from the auth-service JWT; the sidebar
switcher previews another role for the session, but against the real backend the BFF
still enforces the **token's** role on every mutation. Approve / reject controls only
show for `approver` and `admin`. Sessions refresh silently ~5 min before the token
expires; a tab left past expiry lands back on `/login`.

## Architecture

```
graphql/schema.graphql     the GraphQL contract — codegen and the BFF resolvers share it
graphql/operations/*.ts     typed query/mutation documents (graphql() from codegen client-preset)
graphql/generated/          codegen output (gitignored; run `npm run codegen`)
lib/apollo.ts               HttpLink -> /api/graphql, plus the 401 -> /login error link
lib/status.ts               the status colour vocabulary — every badge/dot/rule reads from here
lib/format.ts  risk.ts  csv.ts  validateInvoice.ts   shared business logic (formatting, thresholds, CSV, validation)
server/                     BFF only: resolvers.ts (Hasura-backed), hasura.ts (role-scoped JWT / admin), jwt.ts (HS256 verify+sign), auth.ts (per-request role gate)
components/ui/               DataTable, Badge, RiskDot, StatStrip, Panel, Field, Pagination …
components/invoice/columns.tsx   the reusable invoice-table column set
```

Business rules live in `lib/`, not in pages: money/date formatting (`format.ts`), status →
colour (`status.ts`), delay-risk thresholds (`risk.ts` — `RISK_THRESHOLDS`), invoice
validation shared by manual entry, CSV preview and the import resolver (`validateInvoice.ts`).

## Running against the real backend

Bring up the stack (`infra/docker-compose.yml`), then in `apps/web/.env.local`
(see `.env.example`):

```
NEXT_PUBLIC_AUTH_URL=http://localhost:8095          # browser -> auth-service /login,/refresh
HASURA_ENDPOINT=http://localhost:8088/v1/graphql    # server-only from here down
HASURA_ADMIN_SECRET=devsecret
HASURA_GRAPHQL_JWT_SECRET={"type":"HS256","key":"…"} # same value Hasura + auth-service use
GENAI_SERVICE_URL=http://localhost:8093
REQUIRE_AUTH=                                        # set 1 to reject unauthenticated calls
```

The browser's Apollo client posts the frontend's own operations to `/api/graphql`
(`app/api/graphql/route.ts`). That route verifies the session JWT, and `server/resolvers.ts`
runs them against Hasura: **reads** with a short-lived JWT re-minted for the signed-in
user's role (Hasura's own row/column perms apply), **mutations** with the admin secret,
gated by role in the route. No component, operation, or codegen output changes. To
regenerate types from the live schema, point `schema` in `codegen.ts` at the endpoint
(commented example in the file).

## Notes

- Data pages are client components (`"use client"`) using Apollo hooks, talking to
  `/api/graphql`.
- `npm audit` flags dev/build-time transitive deps (eslint's `glob`, bundled `postcss`) and
  Next itself against advisory ranges that its 14.2.x security backports already cover.
  `next@14.2.35` is the latest patched 14.2. `npm audit fix --force` would pull `next@16`
  (breaking) and is not warranted here.
- Mock mutations mutate in-memory arrays, so changes persist across navigation and reset on
  a full page reload.
