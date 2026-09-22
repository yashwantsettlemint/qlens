"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRole } from "@/lib/role";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { AuthShell } from "@/components/auth/AuthShell";

export default function LoginPage() {
  const { ready, session, login, landingPath } = useRole();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // One redirect path: once a session exists, land on the role's home
  // (dashboard for finance/admin, invoices for approver).
  useEffect(() => {
    if (ready && session) router.replace(landingPath);
  }, [ready, session, landingPath, router]);

  async function submit(u: string, p: string) {
    setBusy(true);
    setError(null);
    const res = await login(u, p);
    setBusy(false);
    if (!res.ok) setError(res.error);
  }

  return (
    <AuthShell>
      <h1 className="font-display text-[28px] font-bold leading-tight text-ink">Welcome back</h1>
      <p className="mb-8 mt-2 text-[15px] text-ink-muted">Sign in to see today&apos;s flagged invoices.</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(username, password);
        }}
        className="space-y-4"
      >
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            className="h-11 w-full rounded-lg border border-line bg-surface px-3.5 text-[15px] text-ink outline-none transition-colors focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="h-11 w-full rounded-lg border border-line bg-surface px-3.5 text-[15px] text-ink outline-none transition-colors focus:border-accent"
          />
        </label>
        {error && (
          <Callout tone="bad" className="text-xs">
            {error}
          </Callout>
        )}
        <Button type="submit" variant="primary" className="h-11 w-full justify-center rounded-lg text-[15px]" disabled={busy || !username}>
          {busy ? "Signing in…" : "Log in"}
        </Button>
      </form>

      <div className="mt-7 text-[14.5px] text-ink-muted">
        New to Qlens?{" "}
        <Link href="/register" className="font-semibold text-accent hover:underline">
          Get access
        </Link>
      </div>
    </AuthShell>
  );
}
