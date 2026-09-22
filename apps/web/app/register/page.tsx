"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRole } from "@/lib/role";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { AuthShell } from "@/components/auth/AuthShell";

export default function RegisterPage() {
  const { ready, session, register, landingPath } = useRole();
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && session) router.replace(landingPath);
  }, [ready, session, landingPath, router]);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await register(companyName, username, email, password);
    setBusy(false);
    if (!res.ok) setError(res.error);
  }

  const field = (label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">{label}</span>
      <input
        {...props}
        className="h-11 w-full rounded-lg border border-line bg-surface px-3.5 text-[15px] text-ink outline-none transition-colors focus:border-accent"
      />
    </label>
  );

  return (
    <AuthShell>
      <h1 className="font-display text-[28px] font-bold leading-tight text-ink">Create your company</h1>
      <p className="mb-8 mt-2 text-[15px] text-ink-muted">
        Start scoring invoices in a couple of minutes. You&apos;ll be the admin — invite your team once you&apos;re in.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-4"
      >
        {field("Company name", { value: companyName, onChange: (e) => setCompanyName(e.target.value), autoFocus: true })}
        {field("Your username", { value: username, onChange: (e) => setUsername(e.target.value), autoComplete: "username" })}
        {field("Work email", { type: "email", value: email, onChange: (e) => setEmail(e.target.value), autoComplete: "email" })}
        {field("Password", {
          type: "password",
          value: password,
          onChange: (e) => setPassword(e.target.value),
          autoComplete: "new-password",
        })}
        {error && (
          <Callout tone="bad" className="text-xs">
            {error}
          </Callout>
        )}
        <Button
          type="submit"
          variant="primary"
          className="h-11 w-full justify-center rounded-lg text-[15px]"
          disabled={busy || !companyName || !username || !email || !password}
        >
          {busy ? "Creating your account…" : "Create account"}
        </Button>
      </form>

      <div className="mt-7 text-[14.5px] text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-accent hover:underline">
          Log in
        </Link>
      </div>
    </AuthShell>
  );
}
