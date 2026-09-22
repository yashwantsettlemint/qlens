"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field, TextInput } from "@/components/ui/Field";
import { QlensMark } from "@/components/brand/QlensMark";
import { useRole } from "@/lib/role";

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteForm />
    </Suspense>
  );
}

function AcceptInviteForm() {
  const token = useSearchParams().get("token") ?? "";
  const { acceptInvite, landingPath } = useRole();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await acceptInvite(token, username, password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.replace(landingPath);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ground px-4 font-plex">
      <div className="w-full max-w-[432px] rounded-2xl border border-line bg-surface p-8 shadow-pop">
        <div className="mb-6 flex items-center gap-2.5">
          <QlensMark size={26} />
          <span className="font-display text-lg font-extrabold tracking-tight text-ink">Qlens</span>
        </div>
        <h1 className="font-display text-2xl font-bold text-ink">Join your team</h1>
        <p className="mb-6 mt-1.5 text-[15px] text-ink-muted">Pick a username and password to finish setting up your account.</p>

        {!token ? (
          <Callout tone="bad" className="text-sm">
            This invite link is missing its token — ask whoever invited you for a fresh link.
          </Callout>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-3.5"
          >
            <Field label="Username">
              <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
            </Field>
            <Field label="Password">
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            {error && (
              <Callout tone="bad" className="text-xs">
                {error}
              </Callout>
            )}
            <Button
              type="submit"
              variant="primary"
              className="h-11 w-full justify-center rounded-lg text-[15px]"
              disabled={busy || !username || !password}
            >
              {busy ? "Joining…" : "Join"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
