"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Mock auth. A real app gets the logged-in user + role from the session; here
 * it is a context value the sidebar can switch, so role-gated actions
 * (approve / reject) can be demoed.
 */
export type Role = "finance_user" | "approver" | "admin";

export const ROLES: { value: Role; label: string }[] = [
  { value: "finance_user", label: "Finance user" },
  { value: "approver", label: "Approver" },
  { value: "admin", label: "Admin" },
];

type Capability = "approve" | "manageVendors";

interface RoleContextValue {
  userId: string;
  role: Role;
  setRole: (r: Role) => void;
  can: (c: Capability) => boolean;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("approver");
  const value = useMemo<RoleContextValue>(
    () => ({
      userId: "u-001",
      role,
      setRole,
      can: (c) => {
        if (c === "approve") return role === "approver" || role === "admin";
        if (c === "manageVendors") return role === "admin";
        return false;
      },
    }),
    [role],
  );
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used inside <RoleProvider>");
  return ctx;
}
