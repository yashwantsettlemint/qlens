import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./server/auth";
import { signHS256 } from "./server/jwt";
import { internalServiceHeaders } from "./server/hasura";

/**
 * Real sign-in: redirects to Keycloak's hosted login (Authorization Code +
 * PKCE, handled entirely by this library) instead of this app collecting a
 * password itself. Registration/invite-accept still happen in our own forms
 * (they do app-specific provisioning — creating a company, assigning a role —
 * that Keycloak's generic self-registration can't do) and still auto-sign-in
 * the same way as before; only the *recurring* login for an existing account
 * goes through Keycloak now.
 *
 * Once Keycloak confirms who the user is, `signIn()` below looks up their
 * company_id/role (still tracked locally in auth-service's `users` table —
 * Keycloak only owns credentials, not the app's role/tenant model) and mints
 * the exact same it_session cookie /api/login used to set, via the same
 * signHS256 helper. Every resolver, requireRole, requireCompanyId, and BFF
 * route that reads that cookie is unchanged by this swap.
 */
const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8095";
const JWT_SECRET = process.env.HASURA_GRAPHQL_JWT_SECRET ?? "";

// Two URLs for the same realm: the browser is redirected to PUBLIC_ISSUER
// (must be reachable from outside docker-compose's network); this Next.js
// server exchanges the code for a token itself, container-to-container, so
// it uses INTERNAL_ISSUER instead — "localhost" inside the web container
// means the container itself, not the host running Keycloak. A real
// deployment behind one public hostname (k8s ingress) doesn't need the
// split; both vars can just be the same URL there.
const PUBLIC_ISSUER = process.env.AUTH_KEYCLOAK_ISSUER ?? "http://localhost:8097/realms/invoice-tracker";
const INTERNAL_ISSUER = process.env.KEYCLOAK_INTERNAL_ISSUER ?? PUBLIC_ISSUER;
const KEYCLOAK_CLIENT_ID = process.env.AUTH_KEYCLOAK_ID ?? "web-bff";

/** Ends Keycloak's own SSO session too — without this, "log out" only drops
 * this app's cookie, and the next "log in" click silently re-authenticates
 * whoever Keycloak still remembers instead of prompting fresh. */
export function keycloakEndSessionUrl(idToken: string | undefined, origin: string): string {
  const url = new URL(`${PUBLIC_ISSUER}/protocol/openid-connect/logout`);
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  url.searchParams.set("client_id", KEYCLOAK_CLIENT_ID);
  url.searchParams.set("post_logout_redirect_uri", `${origin}/login`);
  return url.toString();
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Keycloak({
      issuer: PUBLIC_ISSUER,
      authorization: {
        url: `${PUBLIC_ISSUER}/protocol/openid-connect/auth`,
        // Without this, Keycloak silently re-authenticates whoever's SSO
        // session cookie is still active instead of prompting for
        // credentials — clicking "Log in" would just land you back on the
        // previous account. Every click on this app's own "Log in" button
        // is a real ask to sign in, not an SSO passthrough.
        params: { prompt: "login" },
      },
      token: `${INTERNAL_ISSUER}/protocol/openid-connect/token`,
      userinfo: `${INTERNAL_ISSUER}/protocol/openid-connect/userinfo`,
      jwks_endpoint: `${INTERNAL_ISSUER}/protocol/openid-connect/certs`,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    // Keeps the Keycloak id_token around (server-side only, in NextAuth's own
    // encrypted session cookie) so /api/logout can end Keycloak's SSO session
    // too, not just this app's. Without this, Keycloak keeps remembering
    // whoever last signed in and silently re-authenticates them.
    async jwt({ token, account }) {
      if (account?.id_token) token.idToken = account.id_token;
      return token;
    },
    async session({ session, token }) {
      if (token.idToken) (session as any).idToken = token.idToken;
      return session;
    },
    async signIn({ profile }) {
      const username = profile?.preferred_username;
      if (!username) return false;

      const res = await fetch(`${AUTH_URL}/users/lookup?username=${encodeURIComponent(username)}`, {
        headers: internalServiceHeaders(),
      }).catch(() => null);
      if (!res?.ok) return false;
      const user: { company_id: string; role: string } = await res.json();

      const now = Math.floor(Date.now() / 1000);
      const ttl = 3600;
      const token = signHS256(
        { sub: username, iat: now, exp: now + ttl, role: user.role, user: username, companyId: user.company_id },
        JWT_SECRET,
        ttl,
      );
      (await cookies()).set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: ttl,
      });
      return true;
    },
  },
});
