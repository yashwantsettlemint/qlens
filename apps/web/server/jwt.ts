import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal HS256 verify for the Hasura-shaped tokens auth-service issues.
 * Checks signature + expiry; pulls role/user out of the hasura claims block.
 * No dependency — the BFF just needs to trust or reject the token.
 */
export interface Claims {
  sub: string;
  iat: number;
  exp: number;
  role: string;
  user: string;
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
    role: ns["x-hasura-default-role"] ?? "unknown",
    user: ns["x-hasura-user-id"] ?? payload.sub,
  };
}
