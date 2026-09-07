import type { CodegenConfig } from "@graphql-codegen/cli";

/**
 * Types + typed documents are generated from graphql/schema.graphql (the same
 * SDL the mock resolvers implement). When the real Hasura endpoint is wired,
 * point `schema` at the URL instead:
 *
 *   schema: {
 *     [process.env.NEXT_PUBLIC_HASURA_ENDPOINT!]: {
 *       headers: { "x-hasura-admin-secret": process.env.HASURA_ADMIN_SECRET! },
 *     },
 *   },
 */
const config: CodegenConfig = {
  overwrite: true,
  schema: "./graphql/schema.graphql",
  documents: ["graphql/operations/**/*.ts"],
  generates: {
    "graphql/generated/": {
      preset: "client",
      presetConfig: { fragmentMasking: false },
      config: {
        scalars: { ID: "string" },
        useTypeImports: true,
        enumsAsTypes: true,
      },
    },
  },
};

export default config;
