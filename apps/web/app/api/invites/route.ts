import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth";

/**
 * Proxies POST /invites to auth-service, forwarding the session cookie as
 * the Bearer token — auth-service checks role=admin itself and scopes the
 * invite to the caller's own company_id from that token.
 */
const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8095";

export async function POST(req: Request) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ error: "Sign in as admin to invite teammates." }, { status: 401 });

  const { email, role } = await req.json();

  let res: Response;
  try {
    res = await fetch(`${AUTH_URL}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ email, role }),
    });
  } catch {
    return Response.json({ error: "Can't reach the auth service" }, { status: 503 });
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) return Response.json({ error: body.detail ?? "Could not create the invite" }, { status: res.status });
  return Response.json(body);
}
