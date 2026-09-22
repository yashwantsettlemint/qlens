/**
 * Server-only Hasura client for the /api/graphql BFF route. The admin secret
 * stays on the server — the browser only ever talks to /api/graphql, which
 * speaks the frontend's own schema (graphql/schema.graphql).
 *
 * Auth to Hasura, per request:
 *  - signed-in user  -> a short-lived role-scoped JWT (reads run *as their role*,
 *    so Hasura's own row/column perms apply, not blanket admin).
 *  - no session (demo / offline) -> the admin secret.
 *  - `{ admin: true }` -> force the admin secret. Used by the few mutations whose
 *    frontend contract needs writes a real Hasura role wouldn't be granted
 *    (e.g. approve writes invoices.approval_status directly); the BFF has
 *    already gated those by role in server/auth.ts.
 */
import { currentClaims } from "./auth";
import { signHS256 } from "./jwt";

const ENDPOINT = process.env.HASURA_ENDPOINT ?? "http://localhost:8088/v1/graphql";
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET ?? "devsecret";
const JWT_SECRET = process.env.HASURA_GRAPHQL_JWT_SECRET ?? "";

function authHeaders(admin: boolean): Record<string, string> {
  const claims = currentClaims();
  if (!admin && claims && JWT_SECRET) {
    return { authorization: `Bearer ${signHS256(claims, JWT_SECRET)}` };
  }
  return { "x-hasura-admin-secret": ADMIN_SECRET };
}

export async function hasura<T = any>(
  query: string,
  variables?: Record<string, unknown>,
  opts: { admin?: boolean } = {},
): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(opts.admin ?? false) },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const body = await res.json();
  if (body.errors) throw new Error(body.errors[0]?.message ?? "Hasura error");
  return body.data as T;
}

export const GENAI_URL = process.env.GENAI_SERVICE_URL ?? "http://localhost:8093";
export const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8092";
export const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:8094";

// Sent on every server-to-server call to ingestion/ml/genai/notification/ocr —
// those services trust the network boundary in dev, but require this shared
// secret in prod (see shared_types.auth.require_internal_token).
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? "";
export function internalServiceHeaders(): Record<string, string> {
  return INTERNAL_SERVICE_TOKEN ? { "X-Internal-Token": INTERNAL_SERVICE_TOKEN } : {};
}
