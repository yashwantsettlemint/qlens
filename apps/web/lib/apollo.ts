import { ApolloClient, InMemoryCache, HttpLink, ApolloLink } from "@apollo/client";
import { onError } from "@apollo/client/link/error";

/**
 * Every operation goes to /api/graphql — the server route that verifies the
 * session cookie, enforces role, and runs the schema against Hasura +
 * genai-service.
 *
 * Expired / invalid session -> clear the httpOnly cookie server-side and go
 * back to the login page. There's no client-held token to drop here — the
 * cookie rides along on every /api/graphql request automatically.
 */
const errorLink = onError(({ graphQLErrors }) => {
  if (graphQLErrors?.some((e) => e.extensions?.code === "UNAUTHENTICATED")) {
    fetch("/api/logout", { method: "POST" }).finally(() => {
      if (typeof window !== "undefined") window.location.assign("/login");
    });
  }
});

let client: ApolloClient<unknown> | undefined;

export function getClient() {
  if (!client) {
    client = new ApolloClient({
      link: ApolloLink.from([errorLink, new HttpLink({ uri: "/api/graphql", credentials: "same-origin" })]),
      cache: new InMemoryCache(),
      defaultOptions: {
        watchQuery: { fetchPolicy: "cache-and-network" },
      },
    });
  }
  return client;
}
