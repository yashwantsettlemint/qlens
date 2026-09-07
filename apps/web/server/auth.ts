import { AsyncLocalStorage } from "node:async_hooks";
import { GraphQLError } from "graphql";
import type { Claims } from "./jwt";

/** Per-request store for the verified JWT claims (set by app/api/graphql/route.ts). */
export const requestContext = new AsyncLocalStorage<{ claims: Claims | null }>();

export const currentClaims = (): Claims | null =>
  requestContext.getStore()?.claims ?? null;

/**
 * Gate a resolver on role. If the request carried a (verified) token, its role
 * must be in `roles`. No token -> permissive (demo / offline mode) — the route
 * handler already rejects *invalid* tokens outright.
 */
export function requireRole(...roles: string[]): void {
  const claims = currentClaims();
  if (!claims) return;
  if (!roles.includes(claims.role)) {
    throw new GraphQLError(`Needs role: ${roles.join(" or ")} (you are ${claims.role})`, {
      extensions: { code: "FORBIDDEN" },
    });
  }
}
