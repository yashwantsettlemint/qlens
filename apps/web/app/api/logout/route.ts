import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth";
import { auth, keycloakEndSessionUrl } from "@/auth";

const NEXTAUTH_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.csrf-token",
  "__Host-authjs.csrf-token",
  "authjs.callback-url",
  "__Secure-authjs.callback-url",
  "authjs.pkce.code_verifier",
  "__Secure-authjs.pkce.code_verifier",
];

export async function POST() {
  const session = await auth();
  const origin = (await headers()).get("origin") ?? "http://localhost:3000";

  const response = NextResponse.json({
    ok: true,
    // The client redirects here to end Keycloak's own SSO session too —
    // otherwise the next "log in" silently reuses whoever's still signed in
    // at Keycloak instead of prompting fresh.
    keycloakLogoutUrl: keycloakEndSessionUrl((session as any)?.idToken, origin),
  });
  response.cookies.delete(SESSION_COOKIE);
  for (const name of NEXTAUTH_COOKIES) response.cookies.delete(name);
  return response;
}
