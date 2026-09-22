import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth";
import { verifyHS256 } from "@/server/jwt";

/** BFF: PATCH proxies a user's active flag to auth-service. Same admin gate
 * as /api/users. */
const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8095";
const JWT_SECRET = process.env.HASURA_GRAPHQL_JWT_SECRET ?? "";

const fail = (status: number, message: string) => Response.json({ error: message }, { status });

export async function PATCH(req: Request, { params }: { params: { username: string } }) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return fail(401, "Sign in as admin to manage users.");
  const claims = verifyHS256(token, JWT_SECRET);
  if (!claims) return fail(401, "Your session has expired — sign in again.");
  if (claims.role !== "admin") return fail(403, "Needs role: admin");

  const payload = await req.json().catch(() => null);
  const res = await fetch(`${AUTH_URL}/users/${encodeURIComponent(params.username)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ active: Boolean(payload?.active) }),
  });
  const body = await res.json().catch(() => ({}));
  return Response.json(body, { status: res.status });
}
