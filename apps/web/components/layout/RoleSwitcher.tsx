"use client";

import { ROLES, useRole } from "@/lib/role";
import { Select } from "@/components/ui/Field";

/** Mock: stands in for a real session's user + role. */
export function RoleSwitcher() {
  const { role, setRole, userId } = useRole();
  return (
    <div className="border-t border-line px-3 py-3">
      <div className="mb-1 text-2xs text-ink-muted">
        Signed in · <span className="tabular">{userId}</span>
      </div>
      <Select
        value={role}
        onChange={(e) => setRole(e.target.value as (typeof ROLES)[number]["value"])}
        className="w-full"
        aria-label="Active role"
      >
        {ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
