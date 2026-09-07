"use client";

import { ROLES, useRole } from "@/lib/role";
import { Select } from "@/components/ui/Field";

/** Shows who's signed in; the role select previews another role for this session. */
export function RoleSwitcher() {
  const { user, role, setRole, logout } = useRole();
  return (
    <div className="border-t border-line px-3 py-3">
      <div className="mb-1 flex items-center justify-between text-2xs text-ink-muted">
        <span>
          Signed in · <span className="tabular text-ink">{user}</span>
        </span>
        <button onClick={logout} className="text-accent hover:underline">
          Sign out
        </button>
      </div>
      <Select
        value={role ?? ""}
        onChange={(e) => setRole(e.target.value as (typeof ROLES)[number]["value"])}
        className="w-full"
        aria-label="Active role"
      >
        {ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
        {role && !ROLES.some((r) => r.value === role) && (
          <option value={role}>{role}</option>
        )}
      </Select>
    </div>
  );
}
