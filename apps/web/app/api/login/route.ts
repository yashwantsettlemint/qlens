import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth";

/**
 * Proxies login to auth-service and puts the token in an httpOnly cookie
 * instead of handing it to the browser — JS on the page can never read it,
 * so an XSS bug can't steal the session. The browser only ever learns
 * {user, role, exp}.
 */
const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8095";

export async function POST(req: Request) {
  const { username, password } = await req.json();

  let res: Response;
  try {
    res = await fetch(`${AUTH_URL}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    return NextResponse.json({ error: "Can't reach the auth service", offline: true }, { status: 503 });
  }

  if (res.status === 401) {
    return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: `Auth service error (${res.status})` }, { status: 502 });
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
