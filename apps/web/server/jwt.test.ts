import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { signHS256, verifyHS256, type Claims } from "./jwt";

const SECRET = '{"type":"HS256","key":"dev-jwt-signing-key-change-me-32chars-min"}';

function mint(payload: Record<string, unknown>): string {
  const key = JSON.parse(SECRET).key;
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", key).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

const now = Math.floor(Date.now() / 1000);
const hasuraClaims = (role: string) => ({
  sub: "kavya",
  iat: now,
  exp: now + 3600,
  "https://hasura.io/jwt/claims": {
    "x-hasura-default-role": role,
    "x-hasura-allowed-roles": [role],
    "x-hasura-user-id": "kavya",
  },
});

describe("verifyHS256", () => {
  it("accepts a good token and pulls role/user from the hasura block", () => {
    const c = verifyHS256(mint(hasuraClaims("finance_user")), SECRET);
    expect(c).toMatchObject({ role: "finance_user", user: "kavya", sub: "kavya" });
  });

  it("rejects a tampered signature", () => {
    const t = mint(hasuraClaims("admin"));
    expect(verifyHS256(t.slice(0, -2) + "xx", SECRET)).toBeNull();
  });

  it("rejects an expired token", () => {
    expect(verifyHS256(mint({ ...hasuraClaims("admin"), exp: now - 10 }), SECRET)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyHS256("not.a.jwt", SECRET)).toBeNull();
    expect(verifyHS256("only-one-part", SECRET)).toBeNull();
  });
});

describe("signHS256 round-trips through verifyHS256", () => {
  it("re-mints a role-scoped token the verifier accepts", () => {
    const claims: Claims = { sub: "priya", iat: now, exp: now + 3600, role: "approver", user: "priya" };
    const reverified = verifyHS256(signHS256(claims, SECRET), SECRET);
    expect(reverified).toMatchObject({ role: "approver", user: "priya" });
  });

  it("honours a short TTL", () => {
    const claims: Claims = { sub: "x", iat: now, exp: now + 3600, role: "admin", user: "x" };
    expect(verifyHS256(signHS256(claims, SECRET, -1), SECRET)).toBeNull();
  });
});
