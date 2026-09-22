import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal HS256 verify/sign for the Hasura-shaped tokens auth-service issues.
 * verifyHS256 checks signature + expiry and pulls role/user out of the hasura
 * claims block; signHS256 re-mints a role-scoped token so the BFF can call
 * Hasura *as the signed-in user's role* instead of with the admin secret.
 * No dependency — HS256 is one HMAC.
 */
export interface Claims {
  sub: string;
  iat: number;
  exp: number;
  role: string;
  user: string;
  companyId: string;
}

const HASURA_NS = "https://hasura.io/jwt/claims";
const b64url = (b: Buffer) => b.toString("base64url");

/**
 * Hasura's role literally named "admin" is a reserved super-role that
 * bypasses every permission check (including company_id filtering) no
 * matter what's configured for it — so the app's "admin" business role must
 * never be minted as Hasura role "admin". Mirrors _HASURA_ROLE in
 * services/auth-service/app/main.py.
 */
const HASURA_ROLE: Record<string, string> = { admin: "company_admin" };

/** Re-mint a short-lived Hasura JWT carrying `claims.role` (translated) as the default role. */
export function signHS256(claims: Claims, secretRaw: string, ttlSeconds = 300): string {
  const k = key(secretRaw);
  if (!k) throw new Error("HASURA_GRAPHQL_JWT_SECRET is not set");
  const hasuraRole = HASURA_ROLE[claims.role] ?? claims.role;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        sub: claims.user,
        iat: now - 60, // absorb clock skew — Hasura rejects a future iat
        exp: now + ttlSeconds,
        app_role: claims.role,
        [HASURA_NS]: {
          "x-hasura-default-role": hasuraRole,
          "x-hasura-allowed-roles": [hasuraRole],
          "x-hasura-user-id": claims.user,
          "x-hasura-company-id": claims.companyId,
        },
      }),
    ),
  );
  const sig = b64url(createHmac("sha256", k).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

function key(secretRaw: string): string {
  const s = secretRaw.trim();
  if (s.startsWith("{")) {
    try {
      return JSON.parse(s).key;
    } catch {
      return "";
    }
  }
  return s;
}

export function verifyHS256(token: string, secretRaw: string): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const k = key(secretRaw);
  if (!k) return null;

  const expected = createHmac("sha256", k).update(`${h}.${p}`).digest();
  const got = Buffer.from(sig, "base64url");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;

  let payload: any;
  try {
    payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;

  const ns = payload["https://hasura.io/jwt/claims"] ?? {};
  return {
    sub: payload.sub,
    iat: payload.iat,
    exp: payload.exp,
    // app_role is the real app-facing role (e.g. "admin"); ns's default role
    // may be a translated Hasura-safe name (e.g. "company_admin") — see
    // HASURA_ROLE above. Older tokens without app_role fall back to ns.
    role: payload.app_role ?? ns["x-hasura-default-role"] ?? "unknown",
    user: ns["x-hasura-user-id"] ?? payload.sub,
    companyId: ns["x-hasura-company-id"] ?? "",
  };
}
