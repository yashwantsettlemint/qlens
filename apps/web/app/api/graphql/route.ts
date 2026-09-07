import { graphql } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import typeDefs from "@/graphql/schema.graphql";
import { resolvers } from "@/server/resolvers";

/**
 * BFF: the browser's Apollo client posts the frontend's own operations here
 * (when NEXT_PUBLIC_BACKEND=hasura). This route executes them against the real
 * Hasura API + genai-service, server-side, so the admin secret never ships to
 * the client and no component/operation has to change.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = makeExecutableSchema({ typeDefs, resolvers });

export async function POST(req: Request) {
  const { query, variables, operationName } = await req.json();
  const result = await graphql({
    schema,
    source: query,
    variableValues: variables ?? undefined,
    operationName: operationName ?? undefined,
  });
  return Response.json(result);
}
