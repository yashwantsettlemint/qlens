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
 * Session + role. Backed by auth-service (`/login` issues a Hasura-shaped JWT);
 * the session (user, role, token) is kept in localStorage. `setRole` still lets
 * you preview another role within the session without re-logging-in.
 */
export type Role = "finance_user" | "approver" | "admin" | "genai_readonly";

export const ROLES: { value: Role; label: string }[] = [
  { value: "finance_user", label: "Finance user" },
  { value: "approver", label: "Approver" },
  { value: "admin", label: "Admin" },
];

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8095";
const KEY = "it.session";

type Capability = "approve" | "manageVendors";

export interface Session {
  user: string;
  role: Role;
  token: string | null;
}

interface RoleContextValue {
  ready: boolean;
  session: Session | null;
  user: string | null;
  role: Role | null;
  can: (c: Capability) => boolean;
  setRole: (r: Role) => void;
  login: (
    username: string,
    password: string,
  ) => Promise<{ ok: true } | { ok: false; error: string; offline?: boolean }>;
  loginOffline: (role: Role) => void;
  logout: () => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function write(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode / disabled storage — session stays in memory only */
  }
}

export function RoleProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    setSession(read());
    setReady(true);
  }, []);

  const update = useCallback((s: Session | null) => {
    setSession(s);
    write(s);
  }, []);

  const login = useCallback<RoleContextValue["login"]>(async (username, password) => {
    try {
      const res = await fetch(`${AUTH_URL}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.status === 401) return { ok: false, error: "Wrong username or password" };
      if (!res.ok) return { ok: false, error: `Auth service error (${res.status})` };
      const data = await res.json();
      update({ user: username, role: data.role as Role, token: data.access_token });
      return { ok: true };
    } catch {
      return { ok: false, error: "Can't reach the auth service", offline: true };
    }
  }, [update]);

  const loginOffline = useCallback(
    (role: Role) => update({ user: `${role} (demo)`, role, token: null }),
    [update],
  );

  const value = useMemo<RoleContextValue>(
    () => ({
      ready,
      session,
      user: session?.user ?? null,
      role: session?.role ?? null,
      can: (c) => {
        const role = session?.role;
        if (!role) return false;
        if (c === "approve") return role === "approver" || role === "admin";
        if (c === "manageVendors") return role === "admin";
        return false;
      },
      setRole: (r) => session && update({ ...session, role: r }),
      login,
      loginOffline,
      logout: () => update(null),
    }),
    [ready, session, update, login, loginOffline],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used inside <RoleProvider>");
  return ctx;
}
