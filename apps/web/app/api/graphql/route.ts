import { graphql } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import typeDefs from "@/graphql/schema.graphql";
import { resolvers } from "@/server/resolvers";
import { requestContext } from "@/server/auth";
import { verifyHS256, type Claims } from "@/server/jwt";

/**
 * BFF: the browser's Apollo client posts the frontend's own operations here
 * (when NEXT_PUBLIC_BACKEND=hasura). The route verifies the caller's JWT,
 * enforces role on mutations (server/auth.ts + server/resolvers.ts), and runs
 * the query against Hasura server-side — the admin secret never ships to the
 * client, and no component/operation changes.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = makeExecutableSchema({ typeDefs, resolvers });
const JWT_SECRET = process.env.HASURA_GRAPHQL_JWT_SECRET ?? "";
// Off by default so the stack is demoable with no auth service. Set REQUIRE_AUTH=1
// in any real deployment: then a missing/invalid token is rejected outright.
const REQUIRE_AUTH = /^(1|true|yes)$/i.test(process.env.REQUIRE_AUTH ?? "");

const unauthenticated = (message: string) =>
  Response.json({ errors: [{ message, extensions: { code: "UNAUTHENTICATED" } }] });

export async function POST(req: Request) {
  const { query, variables, operationName } = await req.json();

  let claims: Claims | null = null;
  const authz = req.headers.get("authorization");
  if (authz && authz.toLowerCase().startsWith("bearer ")) {
    claims = verifyHS256(authz.slice(7), JWT_SECRET);
    if (!claims) {
      return unauthenticated("Your session has expired or is invalid — sign in again.");
    }
  }
  if (REQUIRE_AUTH && !claims) {
    return unauthenticated("Sign in to continue.");
  }

  const result = await requestContext.run({ claims }, () =>
    graphql({
      schema,
      source: query,
      variableValues: variables ?? undefined,
      operationName: operationName ?? undefined,
    }),
  );
  return Response.json(result);
}
