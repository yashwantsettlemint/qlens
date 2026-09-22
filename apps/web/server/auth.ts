import { AsyncLocalStorage } from "node:async_hooks";
import { GraphQLError } from "graphql";
import type { Claims } from "./jwt";
import { logSecurityEvent } from "./audit";

/** httpOnly cookie the session JWT is kept in — set/read only by the api/* routes. */
export const SESSION_COOKIE = "it_session";

/** Per-request store for the verified JWT claims (set by app/api/graphql/route.ts). */
export const requestContext = new AsyncLocalStorage<{ claims: Claims | null }>();

export const currentClaims = (): Claims | null =>
  requestContext.getStore()?.claims ?? null;

/**
 * Gate a resolver on role. If the request carried a (verified) token, its role
 * must be in `roles`. No token -> permissive (demo / offline mode) — the route
 * handler already rejects *invalid* tokens outright.
 */
/**
 * The signed-in caller's company_id — every `{admin: true}` mutation in
 * server/resolvers.ts (which bypasses Hasura's own company_id permission
 * filters) must scope its where/insert by this, or it reaches across tenants.
 * No session (demo/offline mode) -> null, and callers fall back to the
 * pre-multi-tenant behavior of not filtering by company.
 */
export function myCompanyId(): string | null {
  return currentClaims()?.companyId || null;
}

export function requireRole(...roles: string[]): void {
  const claims = currentClaims();
  if (!claims) return;
  if (!roles.includes(claims.role)) {
    logSecurityEvent(
      "forbidden_role",
      { user: claims.user, role: claims.role, requiredRoles: roles },
      claims.companyId || null,
    );
    throw new GraphQLError(`Needs role: ${roles.join(" or ")} (you are ${claims.role})`, {
      extensions: { code: "FORBIDDEN" },
    });
  }
}
