import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8095";

export async function POST() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ session: null }, { status: 401 });

  let res: Response;
  try {
    res = await fetch(`${AUTH_URL}/refresh`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return NextResponse.json({ session: null }, { status: 503 });
  }

  if (!res.ok) {
    const response = NextResponse.json({ session: null }, { status: 401 });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  const data = await res.json();
  const exp = Date.now() + data.expires_in * 1000;
  const response = NextResponse.json({ session: { role: data.role, exp } });
  response.cookies.set(SESSION_COOKIE, data.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: data.expires_in,
  });
  return response;
}
