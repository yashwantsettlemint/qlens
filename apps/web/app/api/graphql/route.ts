import { readFileSync } from "node:fs";
import path from "node:path";
import { graphql } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { cookies } from "next/headers";
import { resolvers } from "@/server/resolvers";
import { requestContext, SESSION_COOKIE } from "@/server/auth";
import { verifyHS256, type Claims } from "@/server/jwt";
import { logSecurityEvent } from "@/server/audit";

/**
 * BFF: the browser's Apollo client posts the frontend's own operations here
 * (when NEXT_PUBLIC_BACKEND=hasura). The route verifies the caller's session
 * (an httpOnly cookie set by /api/login — never readable by page JS),
 * enforces role on mutations (server/auth.ts + server/resolvers.ts), and runs
 * the query against Hasura server-side — the admin secret never ships to the
 * client, and no component/operation changes.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const typeDefs = readFileSync(path.join(process.cwd(), "graphql/schema.graphql"), "utf8");
const schema = makeExecutableSchema({ typeDefs, resolvers });
const JWT_SECRET = process.env.HASURA_GRAPHQL_JWT_SECRET ?? "";
// Off by default so the stack is demoable with no auth service. Set REQUIRE_AUTH=1
// in any real deployment: then a missing/invalid token is rejected outright.
const REQUIRE_AUTH = /^(1|true|yes)$/i.test(process.env.REQUIRE_AUTH ?? "");

const unauthenticated = (message: string) =>
  Response.json({ errors: [{ message, extensions: { code: "UNAUTHENTICATED" } }] });

export async function POST(req: Request) {
  let body: { query?: string; variables?: Record<string, unknown>; operationName?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ errors: [{ message: "Empty or invalid request body" }] }, { status: 400 });
  }
  const { query, variables, operationName } = body;
  if (typeof query !== "string") {
    return Response.json({ errors: [{ message: "Missing GraphQL query" }] }, { status: 400 });
  }

  let claims: Claims | null = null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    claims = verifyHS256(token, JWT_SECRET);
    if (!claims) {
      logSecurityEvent("invalid_session", { reason: "bad_or_expired_token" });
      return unauthenticated("Your session has expired or is invalid — sign in again.");
    }
  }
  if (REQUIRE_AUTH && !claims) {
    logSecurityEvent("auth_required_rejected", { operationName });
    return unauthenticated("Sign in to continue.");
  }

  const result = await requestContext.run({ claims }, () =>
    graphql({
      schema,
      source: query,
      variableValues: variables,
      operationName: operationName,
    }),
  );
  return Response.json(result);
}
