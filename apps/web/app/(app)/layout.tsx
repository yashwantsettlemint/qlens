"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRole, type Capability } from "@/lib/role";
import { AppShell } from "@/components/layout/AppShell";

/** Pages that need a capability beyond "signed in". Everything else is open to any role. */
const GATED: { prefix: string; cap: Capability }[] = [
  { prefix: "/upload", cap: "addInvoices" },
  { prefix: "/users", cap: "manageUsers" },
  { prefix: "/forecast", cap: "viewDashboard" },
  { prefix: "/dashboard", cap: "viewDashboard" },
];

/** Everything under here needs a session; unauthenticated -> /login. A role that
 *  can't see the requested page is bounced to /invoices (visible to every role). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { ready, session, can } = useRole();
  const router = useRouter();
  const pathname = usePathname();

  const blocked =
    ready && session
      ? GATED.some(({ prefix, cap }) => pathname.startsWith(prefix) && !can(cap))
      : false;

  useEffect(() => {
    if (ready && !session) router.replace("/login");
    else if (blocked) router.replace("/invoices");
  }, [ready, session, blocked, router]);

  if (!ready || !session || blocked) return null;
  return <AppShell>{children}</AppShell>;
}
