"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/lib/role";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field, TextInput } from "@/components/ui/Field";

const DEV_USERS = [
  { username: "kavya", password: "kavya", label: "Finance user" },
  { username: "priya.nair", password: "priya", label: "Approver" },
  { username: "anjali.rao", password: "anjali", label: "Admin" },
];

export default function LoginPage() {
  const { ready, session, login, loginOffline, landingPath } = useRole();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
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
    if (!res.ok) {
      setError(res.error);
      setOffline(Boolean(res.offline));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ground px-4">
      <div className="w-full max-w-sm border border-line bg-surface">
        <div className="h-1 bg-accent" />
        <div className="p-6">
          <div className="text-sm font-semibold text-ink">Payables Desk</div>
          <div className="mb-5 text-2xs text-ink-muted">Invoice &amp; vendor payments — sign in to continue</div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(username, password);
          }}
          className="space-y-3"
        >
          <Field label="Username">
            <TextInput
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </Field>
          <Field label="Password">
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          {error && (
            <Callout tone="bad" className="text-xs">
              {error}
            </Callout>
          )}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !username}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-2 text-2xs text-ink-muted">Quick sign-in (dev accounts)</div>
          <div className="flex flex-col gap-1.5">
            {DEV_USERS.map((u) => (
              <button
                key={u.username}
                type="button"
                onClick={() => submit(u.username, u.password)}
                disabled={busy}
                className="flex items-center justify-between rounded border border-line px-2.5 py-1.5 text-left text-sm hover:bg-ground disabled:opacity-50"
              >
                <span className="tabular">{u.username}</span>
                <span className="text-xs text-ink-muted">{u.label}</span>
              </button>
            ))}
          </div>
          {offline && (
            <button
              type="button"
              onClick={() => loginOffline("approver")}
              className="mt-3 w-full rounded border border-warn-fg/40 bg-warn-bg px-3 py-1.5 text-xs text-warn-fg hover:bg-warn-bg/70"
            >
              Continue in demo mode as Approver (no backend)
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
