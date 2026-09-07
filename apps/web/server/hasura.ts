/**
 * Server-only Hasura client for the /api/graphql BFF route. The admin secret
 * stays on the server — the browser only ever talks to /api/graphql, which
 * speaks the frontend's own schema (graphql/schema.graphql).
 */
const ENDPOINT =
  process.env.HASURA_ENDPOINT ?? "http://localhost:8088/v1/graphql";
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET ?? "devsecret";

export async function hasura<T = any>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hasura-admin-secret": ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const body = await res.json();
  if (body.errors) throw new Error(body.errors[0]?.message ?? "Hasura error");
  return body.data as T;
}

export const GENAI_URL = process.env.GENAI_SERVICE_URL ?? "http://localhost:8093";
