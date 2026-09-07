import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  ApolloLink,
} from "@apollo/client";
import { onError } from "@apollo/client/link/error";
import { SchemaLink } from "@apollo/client/link/schema";
import { schema } from "@/mock/schema";

/**
 * Default: the in-browser mock schema (no backend needed).
 * NEXT_PUBLIC_BACKEND=hasura -> talk to /api/graphql, the server route that
 * verifies the session JWT, enforces role, and runs the same schema against the
 * real Hasura API + genai-service. Nothing in the components or operations changes.
 */

/** Attach the stored session token so the BFF can verify + role-check it. */
const authLink = new ApolloLink((operation, forward) => {
  try {
    const raw = localStorage.getItem("it.session");
    const token = raw ? JSON.parse(raw).token : null;
    if (token) {
      operation.setContext(({ headers = {} }: { headers?: Record<string, string> }) => ({
        headers: { ...headers, authorization: `Bearer ${token}` },
      }));
    }
  } catch {
    /* no/blocked storage — fall through unauthenticated */
  }
  return forward(operation);
});

/** Expired / invalid session -> drop it and go back to the login page. */
const errorLink = onError(({ graphQLErrors }) => {
  if (graphQLErrors?.some((e) => e.extensions?.code === "UNAUTHENTICATED")) {
    try {
      localStorage.removeItem("it.session");
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined") window.location.assign("/login");
  }
});

function link(): ApolloLink {
  if (process.env.NEXT_PUBLIC_BACKEND === "hasura") {
    return ApolloLink.from([errorLink, authLink, new HttpLink({ uri: "/api/graphql" })]);
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
