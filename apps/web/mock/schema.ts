import { makeExecutableSchema } from "@graphql-tools/schema";
import typeDefs from "@/graphql/schema.graphql";
import { resolvers } from "./resolvers";

/**
 * The executable mock schema, used by Apollo's SchemaLink (lib/apollo.ts) when
 * no real endpoint is configured. Codegen reads graphql/schema.graphql directly.
 */
export const schema = makeExecutableSchema({ typeDefs, resolvers });
export default schema;
