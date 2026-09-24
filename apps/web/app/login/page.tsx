"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useRole } from "@/lib/role";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { AuthShell } from "@/components/auth/AuthShell";

export default function LoginPage() {
  const { ready, session, landingPath } = useRole();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // One redirect path: once a session exists, land on the role's home
  // (dashboard for finance/admin, invoices for approver).
  useEffect(() => {
    if (ready && session) router.replace(landingPath);
  }, [ready, session, landingPath, router]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // Redirects to Keycloak's own hosted login page — this app never sees
      // the password. Coming back, our signIn callback (see ../../../auth.ts)
      // sets the session cookie the rest of the app already expects.
      await signIn("keycloak", { callbackUrl: "/" });
    } catch {
      setBusy(false);
      setError("Can't reach the identity provider — is the stack up?");
    }
  }

  return (
    <AuthShell>
      <h1 className="font-display text-[28px] font-bold leading-tight text-ink">Welcome back</h1>
      <p className="mb-8 mt-2 text-[15px] text-ink-muted">Sign in to see today&apos;s flagged invoices.</p>

      {error && (
        <Callout tone="bad" className="mb-4 text-xs">
          {error}
        </Callout>
      )}
      <Button
        type="button"
        variant="primary"
        className="h-11 w-full justify-center rounded-lg text-[15px]"
        disabled={busy}
        onClick={submit}
      >
        {busy ? "Redirecting…" : "Log in"}
      </Button>

      <div className="mt-7 text-[14.5px] text-ink-muted">
        New to Qlens?{" "}
        <Link href="/register" className="font-semibold text-accent hover:underline">
          Get access
        </Link>
      </div>
    </AuthShell>
  );
}
