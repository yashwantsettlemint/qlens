import { describe, expect, it, vi, beforeEach } from "vitest";

// Regression test for the leak fixed 2026-09-22: authHeaders() used to fall
// back to the raw Hasura admin secret whenever there was no session, which
// bypasses every company_id permission filter and returns every tenant's
// data. It must now mint a role-scoped JWT instead, even with no session.

// HASURA_GRAPHQL_JWT_SECRET is set in vitest.config.ts's test.env (needed to
// mint/verify tokens); HASURA_ADMIN_SECRET falls back to hasura.ts's own
// "devsecret" default, same as an unconfigured dev environment.

vi.mock("./auth", () => ({ currentClaims: vi.fn(() => null) }));

import { currentClaims } from "./auth";
import { hasura } from "./hasura";
import { verifyHS256 } from "./jwt";

function mockFetchCapturingHeaders() {
  const captured: { headers?: Record<string, string> } = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, opts: any) => {
      captured.headers = opts.headers;
      return { json: async () => ({ data: {} }) } as any;
    }),
  );
  return captured;
}

beforeEach(() => {
  vi.mocked(currentClaims).mockReturnValue(null);
});

describe("hasura() tenant scoping", () => {
  it("never sends the admin secret for an unauthenticated, non-admin call", async () => {
    const captured = mockFetchCapturingHeaders();
    await hasura("query { __typename }");
    expect(captured.headers?.["x-hasura-admin-secret"]).toBeUndefined();
    expect(captured.headers?.authorization).toMatch(/^Bearer /);
  });

  it("scopes the unauthenticated request to the seed demo company only", async () => {
    const captured = mockFetchCapturingHeaders();
    await hasura("query { __typename }");
    const token = captured.headers!.authorization.replace("Bearer ", "");
    const claims = verifyHS256(token, process.env.HASURA_GRAPHQL_JWT_SECRET!);
    expect(claims?.companyId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("scopes a signed-in user's request to their own company, not the demo tenant", async () => {
    vi.mocked(currentClaims).mockReturnValue({
      sub: "u1",
      iat: 0,
      exp: 0,
      role: "finance_user",
      user: "u1",
      companyId: "tenant-a-company-id",
    });
    const captured = mockFetchCapturingHeaders();
    await hasura("query { __typename }");
    const token = captured.headers!.authorization.replace("Bearer ", "");
    const claims = verifyHS256(token, process.env.HASURA_GRAPHQL_JWT_SECRET!);
    expect(claims?.companyId).toBe("tenant-a-company-id");
  });

  it("only sends the admin secret when the caller explicitly asks for { admin: true }", async () => {
    const captured = mockFetchCapturingHeaders();
    await hasura("mutation { __typename }", undefined, { admin: true });
    expect(captured.headers?.["x-hasura-admin-secret"]).toBe("devsecret");
    expect(captured.headers?.authorization).toBeUndefined();
  });
});
