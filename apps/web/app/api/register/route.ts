import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth";

/**
 * Proxies sign-up to auth-service's POST /register (creates a new company +
 * its first admin user) and sets the session cookie exactly like
 * /api/login — same reasoning: the token never touches page JS.
 */
const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8095";

export async function POST(req: Request) {
  const { companyName, username, email, password } = await req.json();

  let res: Response;
  try {
    res = await fetch(`${AUTH_URL}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ company_name: companyName, username, email, password }),
    });
  } catch {
    return NextResponse.json({ error: "Can't reach the auth service", offline: true }, { status: 503 });
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return NextResponse.json({ error: body.detail ?? `Could not create your account (${res.status})` }, { status: res.status === 400 ? 400 : 502 });
  }

  const data = await res.json();
  const exp = Date.now() + data.expires_in * 1000;
  const response = NextResponse.json({ user: username, role: data.role, exp });
  response.cookies.set(SESSION_COOKIE, data.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: data.expires_in,
  });
  return response;
}
