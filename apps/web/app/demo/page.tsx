"use client";

import { useState } from "react";
import Link from "next/link";
import { QlensMark } from "@/components/brand/QlensMark";
import { Callout } from "@/components/ui/Callout";

const COMPANY_SIZES = ["1–10", "11–50", "51–200", "200+"];

const WHAT_HAPPENS = [
  "We reply within a business day to find a time.",
  "A 20-minute walkthrough on your own invoices, if you'd like to share a sample.",
  "No commitment — you can also just start a free trial yourself.",
];

export default function BookDemoPage() {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName, contactName, workEmail, companySize, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong — try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen font-plex">
      <div className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-[50%] lg:px-16 xl:px-20">
        <div className="mx-auto w-full max-w-[440px]">
          <Link href="/" className="mb-9 flex items-center gap-2.5">
            <QlensMark size={26} />
            <span className="font-display text-lg font-extrabold tracking-tight text-ink">Qlens</span>
          </Link>

          {sent ? (
            <div>
              <h1 className="font-display text-[28px] font-bold leading-tight text-ink">Thanks — we&apos;ll be in touch.</h1>
              <p className="mt-3 text-[15px] text-ink-muted">
                Someone from the team will reach out within a business day to find a time that works.
                In the meantime, you can also just start a free trial yourself.
              </p>
              <Link
                href="/register"
                className="mt-6 inline-flex h-11 items-center rounded-lg border border-accent bg-accent px-6 text-[15px] font-semibold text-accent-ink hover:brightness-105"
              >
                Start free trial
              </Link>
            </div>
          ) : (
            <>
              <h1 className="font-display text-[28px] font-bold leading-tight text-ink">Book a demo</h1>
              <p className="mb-8 mt-2 text-[15px] text-ink-muted">
                Tell us a bit about your team and we&apos;ll walk you through Qlens on your own invoices.
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
                className="space-y-4"
              >
                <TextField label="Company name" value={companyName} onChange={setCompanyName} autoFocus />
                <TextField label="Your name" value={contactName} onChange={setContactName} />
                <TextField label="Work email" type="email" value={workEmail} onChange={setWorkEmail} />

                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">Company size</span>
                  <select
                    value={companySize}
                    onChange={(e) => setCompanySize(e.target.value)}
                    className="h-11 w-full rounded-lg border border-line bg-surface px-3.5 text-[15px] text-ink outline-none transition-colors focus:border-accent"
                  >
                    <option value="">Prefer not to say</option>
                    {COMPANY_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s} employees
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">What would you like to see? (optional)</span>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink outline-none transition-colors focus:border-accent"
                  />
                </label>

                {error && (
                  <Callout tone="bad" className="text-xs">
                    {error}
                  </Callout>
                )}

                <button
                  type="submit"
                  disabled={busy || !companyName || !contactName || !workEmail}
                  className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-accent bg-accent text-[15px] font-semibold text-accent-ink transition-colors hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Sending…" : "Request a demo"}
                </button>
              </form>

              <div className="mt-7 text-[14.5px] text-ink-muted">
                Rather just try it?{" "}
                <Link href="/register" className="font-semibold text-accent hover:underline">
                  Start free
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-panel-navy lg:flex lg:w-[50%] lg:flex-col lg:justify-center lg:px-16 xl:px-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(var(--panel-navy-line) 1px, transparent 1px), linear-gradient(90deg, var(--panel-navy-line) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative max-w-[420px]">
          <p className="font-display text-2xl font-semibold text-white">What happens next</p>
          <div className="mt-7 space-y-5">
            {WHAT_HAPPENS.map((step, i) => (
              <div key={step} className="flex gap-3.5">
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-panel-navy-line font-mono text-xs font-semibold text-[#f3b354]">
                  {i + 1}
                </span>
                <p className="text-[15px] text-panel-navy-ink">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        className="h-11 w-full rounded-lg border border-line bg-surface px-3.5 text-[15px] text-ink outline-none transition-colors focus:border-accent"
      />
    </label>
  );
}
