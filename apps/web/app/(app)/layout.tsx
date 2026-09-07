"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/lib/role";
import { AppShell } from "@/components/layout/AppShell";

/** Everything under here needs a session; unauthenticated -> /login. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { ready, session } = useRole();
  const router = useRouter();

  useEffect(() => {
    if (ready && !session) router.replace("/login");
  }, [ready, session, router]);

  if (!ready || !session) return null;
  return <AppShell>{children}</AppShell>;
}
