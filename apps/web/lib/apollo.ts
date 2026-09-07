import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  type ApolloLink,
} from "@apollo/client";
import { SchemaLink } from "@apollo/client/link/schema";
import { schema } from "@/mock/schema";

/**
 * Default: the in-browser mock schema (no backend needed).
 * NEXT_PUBLIC_BACKEND=hasura -> talk to /api/graphql, the server route that
 * runs the same schema against the real Hasura API + genai-service. Either way
 * nothing in the components or operations changes.
 */
function link(): ApolloLink {
  if (process.env.NEXT_PUBLIC_BACKEND === "hasura") {
    return new HttpLink({ uri: "/api/graphql" });
  }
  // ponytail: mock schema is bundled unconditionally; dynamic-import it here
  // if the client bundle size ever matters.
  return new SchemaLink({ schema });
}

let client: ApolloClient<unknown> | undefined;

export function getClient() {
  if (!client) {
    client = new ApolloClient({
      link: link(),
      cache: new InMemoryCache(),
      defaultOptions: {
        watchQuery: { fetchPolicy: "cache-and-network" },
      },
    });
  }
  return client;
}
