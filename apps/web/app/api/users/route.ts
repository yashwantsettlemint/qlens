import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth";
import { verifyHS256 } from "@/server/jwt";

/**
 * BFF: proxies user management to auth-service. The browser can no longer
 * hold the token itself (it's httpOnly) — this route reads it from the
 * cookie server-side and forwards it as auth-service's own Bearer header.
 */
const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8095";
const JWT_SECRET = process.env.HASURA_GRAPHQL_JWT_SECRET ?? "";

const fail = (status: number, message: string) => Response.json({ error: message }, { status });

function requireAdmin(): { error: Response | null; token: string | null } {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return { error: fail(401, "Sign in as admin to manage users."), token: null };
  const claims = verifyHS256(token, JWT_SECRET);
  if (!claims) return { error: fail(401, "Your session has expired — sign in again."), token: null };
  if (claims.role !== "admin") return { error: fail(403, "Needs role: admin"), token: null };
  return { error: null, token };
}

export async function GET() {
  const { error, token } = requireAdmin();
  if (error) return error;

  const res = await fetch(`${AUTH_URL}/users`, { headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  return Response.json(body, { status: res.status });
}

export async function POST(req: Request) {
  const { error, token } = requireAdmin();
  if (error) return error;

  const payload = await req.json();
  const res = await fetch(`${AUTH_URL}/users`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return Response.json(body, { status: res.status });
}
