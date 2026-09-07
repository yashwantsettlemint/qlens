# Payables Desk — Invoice Processing & Vendor Payment Tracker

Internal AP tool frontend. Next.js (App Router) + TypeScript + Tailwind, Apollo Client
against a **fully mocked** GraphQL layer so every screen is clickable and demoable with no
backend. Swapping in the real Hasura API is a one-line change.

## Run it

```bash
npm install
npm run codegen      # generate typed GraphQL hooks (also runs automatically before build)
npm run dev          # http://localhost:3000
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

Role (`finance_user` / `approver` / `admin`) is a mock context value — switch it in the
sidebar. Approve / reject controls only show for `approver` and `admin`.

## Architecture

```
graphql/schema.graphql     the GraphQL contract — mock resolvers, codegen, and real Hasura all share it
graphql/operations/*.ts     typed query/mutation documents (graphql() from codegen client-preset)
graphql/generated/          codegen output (gitignored; run `npm run codegen`)
mock/data.ts                seeded, deterministic dataset (Indian vendors, INR, GST) — mutable in-session
mock/resolvers.ts           resolves queries against mock/data with real filter/sort/paginate; mutations mutate it
mock/schema.ts              makeExecutableSchema(schema.graphql, resolvers)
lib/apollo.ts               SchemaLink (mock) vs HttpLink (real) — the whole swap
lib/status.ts               the status colour vocabulary — every badge/dot/rule reads from here
lib/format.ts  risk.ts  csv.ts  validateInvoice.ts   shared business logic (formatting, thresholds, CSV, validation)
components/ui/               DataTable, Badge, RiskDot, StatStrip, Panel, Field, Pagination …
components/invoice/columns.tsx   the reusable invoice-table column set
```

Business rules live in `lib/`, not in pages: money/date formatting (`format.ts`), status →
colour (`status.ts`), delay-risk thresholds (`risk.ts` — `RISK_THRESHOLDS`), invoice
validation shared by manual entry, CSV preview and the import resolver (`validateInvoice.ts`).

## Wiring the real Hasura endpoint

Set in `.env.local` (see `.env.example`):

```
NEXT_PUBLIC_HASURA_ENDPOINT=https://your-hasura/v1/graphql
NEXT_PUBLIC_HASURA_ADMIN_SECRET=…        # or NEXT_PUBLIC_HASURA_JWT=…
```

`lib/apollo.ts` then uses `HttpLink` with the right header instead of the in-browser mock
schema — nothing in the components changes. To regenerate types from the live schema,
point `schema` in `codegen.ts` at the endpoint (commented example in the file).

## Notes

- Data pages are client components (`"use client"`) using Apollo hooks; the mock executable
  schema is bundled to the client so SchemaLink can run without a server. When
  `NEXT_PUBLIC_HASURA_ENDPOINT` is set it's unused — dynamic-import it if bundle size
  matters (`ponytail:` comment in `lib/apollo.ts`).
- `npm audit` flags dev/build-time transitive deps (eslint's `glob`, bundled `postcss`) and
  Next itself against advisory ranges that its 14.2.x security backports already cover.
  `next@14.2.35` is the latest patched 14.2. `npm audit fix --force` would pull `next@16`
  (breaking) and is not warranted here.
- Mock mutations mutate in-memory arrays, so changes persist across navigation and reset on
  a full page reload.
