"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Session + role. Backed by auth-service (`/login` issues a Hasura-shaped JWT),
 * proxied through this app's own /api/login so the token lives in an httpOnly
 * cookie — page JS never sees it, only {user, role, exp}. `setRole` still lets
 * you preview another role within the session without re-logging-in.
 */
export type Role = "finance_user" | "approver" | "admin" | "genai_readonly";

export const ROLES: { value: Role; label: string }[] = [
  { value: "finance_user", label: "Finance team" },
  { value: "approver", label: "Approver" },
  { value: "admin", label: "Admin" },
];

/**
 * What each role can do. The BFF enforces the same split server-side on every
 * mutation (apps/web/server/auth.ts); this is the UI half — which pages and
 * controls to show.
 *
 *   finance_user  dashboard + record payments + add/import invoices
 *   approver      approve / reject only (no dashboard, no payments, no upload)
 *   admin         dashboard, approve, payments, user management + the admin
 *                 stats block — but NOT invoice upload (that's finance_user's job)
 */
export type Capability =
  | "viewDashboard"
  | "approve"
  | "recordPayment"
  | "addInvoices"
  | "viewAdminStats"
  | "manageUsers"
  | "manageSettings"
  | "deleteInvoice";

const ROLE_CAPS: Record<Role, Capability[]> = {
  finance_user: ["viewDashboard", "recordPayment", "addInvoices", "deleteInvoice", "manageSettings"],
  approver: ["approve"],
  admin: [
    "viewDashboard",
    "approve",
    "recordPayment",
    "viewAdminStats",
    "manageUsers",
    "manageSettings",
    "deleteInvoice",
  ],
  genai_readonly: [],
};

export interface Session {
  user: string;
  role: Role;
  /** ms epoch the session expires at. */
  exp: number;
}

interface RoleContextValue {
  ready: boolean;
  session: Session | null;
  user: string | null;
  role: Role | null;
  can: (c: Capability) => boolean;
  /** Where this role should land after login (approver has no dashboard). */
  landingPath: string;
  setRole: (r: Role) => void;
  login: (
    username: string,
    password: string,
  ) => Promise<{ ok: true } | { ok: false; error: string; offline?: boolean }>;
  register: (
    companyName: string,
    username: string,
    email: string,
    password: string,
  ) => Promise<{ ok: true } | { ok: false; error: string; offline?: boolean }>;
  acceptInvite: (
    token: string,
    username: string,
    password: string,
  ) => Promise<{ ok: true } | { ok: false; error: string; offline?: boolean }>;
  logout: () => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  // On load: ask the server what the httpOnly cookie says (JS can't read it
  // directly).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/session");
        const data = await res.json();
        setSession(data.session ?? null);
      } catch {
        setSession(null); // auth route unreachable — treat as signed out
      }
      setReady(true);
    })();
  }, []);

  const login = useCallback<RoleContextValue["login"]>(async (username, password) => {
    let res: Response;
    try {
      res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
    } catch {
      return { ok: false, error: "Can't reach the auth service", offline: true };
    }
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error ?? `Auth service error (${res.status})`, offline: data.offline };
    }
    setSession({ user: data.user, role: data.role as Role, exp: data.exp });
    return { ok: true };
  }, []);

  const register = useCallback<RoleContextValue["register"]>(async (companyName, username, email, password) => {
    let res: Response;
    try {
      res = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName, username, email, password }),
      });
    } catch {
      return { ok: false, error: "Can't reach the auth service", offline: true };
    }
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error ?? `Auth service error (${res.status})`, offline: data.offline };
    }
    setSession({ user: data.user, role: data.role as Role, exp: data.exp });
    return { ok: true };
  }, []);

  const acceptInvite = useCallback<RoleContextValue["acceptInvite"]>(async (token, username, password) => {
    let res: Response;
    try {
      res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, username, password }),
      });
    } catch {
      return { ok: false, error: "Can't reach the auth service", offline: true };
    }
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error ?? `Auth service error (${res.status})`, offline: data.offline };
    }
    setSession({ user: data.user, role: data.role as Role, exp: data.exp });
    return { ok: true };
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    fetch("/api/logout", { method: "POST" }).catch(() => {});
  }, []);

  // Silent refresh: swap in a fresh cookie ~5 min before the current one expires.
  // A tab left closed past expiry can't refresh -> next API call 401s -> /login.
  useEffect(() => {
    const exp = session?.exp;
    if (!exp) return;
    const delay = Math.max(0, exp - Date.now() - 5 * 60_000);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/refresh", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data.session) {
          setSession(null);
          return;
        }
        setSession((s) => (s ? { ...s, role: data.session.role, exp: data.session.exp } : s));
      } catch {
        /* offline — keep the session, the effect retries on the next change */
      }
    }, delay);
    return () => clearTimeout(t);
  }, [session?.exp]);

  const value = useMemo<RoleContextValue>(
    () => ({
      ready,
      session,
      user: session?.user ?? null,
      role: session?.role ?? null,
      can: (c) => {
        const role = session?.role;
        return role ? ROLE_CAPS[role].includes(c) : false;
      },
      landingPath:
        session?.role && ROLE_CAPS[session.role].includes("viewDashboard")
          ? "/dashboard"
          : "/invoices",
      setRole: (r) => session && setSession({ ...session, role: r }),
      login,
      register,
      acceptInvite,
      logout,
    }),
    [ready, session, login, register, acceptInvite, logout],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used inside <RoleProvider>");
  return ctx;
}
