"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRole } from "@/lib/role";
import { Badge } from "@/components/ui/Badge";
import { QlensMark } from "@/components/brand/QlensMark";

const STEPS = [
  { title: "Capture", body: "Upload a PDF, import a CSV, or enter it by hand. Fields are read and validated before anything is saved." },
  { title: "Check", body: "Each invoice is scored for duplicates against the vendor's history, and for the chance it gets paid late." },
  { title: "Approve and pay", body: "Approvers sign off, finance records the payment, and anything past due is flagged." },
];

const VENDOR_EXPOSURE = [
  { name: "Deccan Steel", amount: "₹6.4L", raw: 6.4, onTime: 61, tone: "bad" as const },
  { name: "Kaveri Textiles", amount: "₹4.5L", raw: 4.5, onTime: 78, tone: "ok" as const },
  { name: "Greenfield Agro", amount: "₹3.2L", raw: 3.2, onTime: 90, tone: "ok" as const },
  { name: "Nizam Foods", amount: "₹2.1L", raw: 2.1, onTime: 95, tone: "ok" as const },
];

const DASHBOARD_ROWS = [
  { vendor: "Deccan Steel", invoice: "DS-2026-883", due: "28 Oct", status: "Possible duplicate", tone: "dup" as const, amount: "₹2,95,000" },
  { vendor: "Kaveri Textiles", invoice: "KT/0139", due: "12 Sep", status: "Overdue 9 days", tone: "bad" as const, amount: "₹3,40,900" },
  { vendor: "Greenfield Agro", invoice: "GA-2211", due: "2 Oct", status: "Pending approval", tone: "warn" as const, amount: "₹1,20,000" },
  { vendor: "Nizam Foods", invoice: "NF-0044", due: "6 Oct", status: "Approved", tone: "ok" as const, amount: "₹1,03,000" },
  { vendor: "Sri Balaji Traders", invoice: "SBT-142", due: "30 Sep", status: "Paid", tone: "ok" as const, amount: "₹48,500" },
];

const PRICING = [
  {
    name: "Starter",
    price: "₹0",
    period: "/month",
    desc: "For small teams getting started.",
    features: ["100 invoices a month", "3 users", "PDF, CSV and manual capture", "Email overdue digest"],
    cta: "Start free",
    href: "/register",
    highlight: false,
  },
  {
    name: "Growth",
    price: "₹4,999",
    period: "/month",
    desc: "For finance teams with a steady flow of supplier bills.",
    features: ["2,000 invoices a month", "Unlimited users and approvers", "Slack digest and Ask assistant", "Bulk approve and CSV export"],
    cta: "Start 14-day trial",
    href: "/register",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "For high volumes and multiple entities.",
    features: ["Unlimited invoices", "Models retrained on your data", "SSO and dedicated support"],
    cta: "Talk to sales",
    href: "/demo",
    highlight: false,
  },
];

type TryResult = {
  fileName: string;
  risk: number;
  lateDays: number;
  isDup: boolean;
  reasons: { tone: "ok" | "warn"; text: string }[];
};

// ponytail: score is seeded from the filename/size, not a real parse — swap for the real scoring API when there is one
function scoreFile(file: File): TryResult {
  let seed = file.size % 97;
  for (let i = 0; i < file.name.length; i++) seed += file.name.charCodeAt(i);
  const risk = 12 + (seed % 82);
  const lateDays = 1 + (seed % 9);
  const isDup = seed % 6 === 0;
  const reasons: TryResult["reasons"] =
    risk >= 55
      ? [
          { tone: "warn", text: "Vendor has a history of late payments" },
          { tone: "warn", text: "No purchase order linked" },
          { tone: "ok", text: "Invoice amount is below vendor average" },
        ]
      : [
          { tone: "ok", text: "Vendor's on-time payment history" },
          { tone: "ok", text: "PO linked and matched" },
          { tone: "warn", text: "Invoice received close to due date" },
        ];
  return { fileName: file.name, risk, lateDays, isDup, reasons };
}

export default function LandingPage() {
  const { ready, session, landingPath } = useRole();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<TryResult | null>(null);

  useEffect(() => {
    if (ready && session) router.replace(landingPath);
  }, [ready, session, landingPath, router]);

  function handleFile(file: File) {
    setReading(true);
    setResult(null);
    window.setTimeout(() => {
      setReading(false);
      setResult(scoreFile(file));
    }, 850);
  }

  return (
    <div className="min-h-screen bg-ground font-plex">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-line bg-ground/90 px-6 backdrop-blur">
        <span className="flex items-center gap-2.5 font-display text-xl font-extrabold tracking-tight text-ink">
          <QlensMark size={30} />
          Qlens
        </span>
        <nav className="hidden items-center gap-6 text-sm text-ink-muted sm:flex">
          <a href="#features" className="hover:text-ink">
            Product
          </a>
          <a href="#pricing" className="hover:text-ink">
            Pricing
          </a>
          <a href="#controls" className="hover:text-ink">
            Security
          </a>
          <a href="#how" className="hover:text-ink">
            How it works
          </a>
        </nav>
        <div className="flex items-center gap-4">
          <Link href="/login" className="hidden text-sm font-semibold text-ink hover:text-accent sm:inline-flex">
            Sign in
          </Link>
          <Link
            href="/demo"
            className="inline-flex h-9 items-center rounded-lg border border-accent bg-accent px-4 text-sm font-semibold text-accent-ink shadow-[0_1px_2px_rgb(18_63_48/0.3),0_8px_20px_-8px_rgb(18_63_48/0.5)] hover:brightness-105"
          >
            Book a demo
          </Link>
        </div>
      </header>

      {/* ---------- Hero: headline left, product card right ---------- */}
      <section className="mx-auto max-w-content px-6 pb-10 pt-16 lg:pb-16 lg:pt-20">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_460px]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3.5 py-1.5 text-sm font-medium text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              AI for accounts payable
            </span>
            <h1 className="mt-6 max-w-[15ch] font-display text-[44px] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink sm:text-[56px]">
              Check every invoice before you pay it.
            </h1>
            <p className="mt-6 max-w-[46ch] text-lg text-ink-muted">
              Qlens reads your invoices, flags duplicates before they&apos;re paid twice, predicts
              which bills will slip past their due date, and routes each one to the right approver.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/register"
                className="inline-flex h-[46px] items-center rounded-lg border border-accent bg-accent px-6 text-base font-semibold text-accent-ink shadow-[0_1px_2px_rgb(18_63_48/0.3),0_8px_20px_-8px_rgb(18_63_48/0.5)] hover:brightness-105"
              >
                Start free trial
              </Link>
              <Link
                href="/demo"
                className="inline-flex h-[46px] items-center rounded-lg border border-line bg-surface px-6 text-base font-semibold text-ink hover:border-ink-muted"
              >
                Book a demo
              </Link>
            </div>
            <p className="mt-4 text-xs text-ink-muted">Free for your first 100 invoices each month. No card needed.</p>
          </div>

          <RiskCard
            invoiceNumber="INV-2048"
            meta="received today"
            vendor="Acme Traders Pvt Ltd"
            amount="₹2,40,000"
            sub="payable · net 30"
            badges={[
              { tone: "warn", label: "Likely 6 days late" },
              { tone: "ok", label: "No duplicate found" },
            ]}
            risk={73}
            reasons={[
              { tone: "ok", text: "Vendor's on-time history — lowers risk" },
              { tone: "warn", text: "Large invoice amount — raises risk" },
              { tone: "warn", text: "No purchase order linked — raises risk" },
            ]}
          />
        </div>
      </section>

      {/* ---------- Intake strip ---------- */}
      <section className="border-y border-line bg-surface/60 px-6 py-6">
        <div className="mx-auto flex max-w-content flex-col items-center justify-between gap-4 sm:flex-row">
          <span className="inline-flex flex-wrap items-center gap-x-5 gap-y-2 rounded-full border border-line bg-surface px-5 py-2.5 text-sm text-ink-muted">
            <Legend tone="bad" label="PDF upload" />
            <Legend tone="ok" label="CSV import" />
            <Legend tone="dup" label="Manual entry" />
          </span>
          <p className="text-sm text-ink-muted">Bring in invoices however they arrive. Every one gets the same checks.</p>
        </div>
      </section>

      {/* ---------- Process: 3 steps, connected ---------- */}
      <section id="how" className="mx-auto max-w-content px-6 py-20">
        <h2 className="max-w-[26ch] font-display text-3xl font-bold tracking-tight text-ink sm:text-[40px]">
          From supplier bill to paid, with checks at every step
        </h2>
        <p className="mt-3 max-w-[56ch] text-base text-ink-muted">
          Your team stops re-typing invoices and hunting for duplicates. They review what the AI
          flags and approve the rest.
        </p>
        <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="flex items-center gap-3 sm:block">
              <div className="flex items-center gap-3 sm:mb-4">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-accent font-mono text-sm font-semibold text-accent-ink">
                  {i + 1}
                </span>
                <span className={`hidden h-px flex-1 border-t border-dashed border-line sm:block ${i === STEPS.length - 1 ? "opacity-0" : ""}`} />
              </div>
              <div>
                <div className="font-display text-lg font-semibold text-ink">{s.title}</div>
                <p className="mt-1 text-sm text-ink-muted">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Feature row 1: duplicate detection ---------- */}
      <section id="features" className="mx-auto max-w-content px-6 py-8">
        <FeatureRow
          eyebrow="Duplicate detection"
          title="Stop paying the same bill twice"
          body="A machine-learning model compares each new invoice with the vendor's past invoices: amounts, tax, dates, PO and near-identical invoice numbers like DS/0883 and DS-883."
          bullets={[
            "Checked the moment an invoice is added or edited",
            "A reviewer confirms or clears every flag",
            "Each decision makes the model sharper for your vendors",
          ]}
        >
          <DuplicateCard />
        </FeatureRow>
      </section>

      {/* ---------- Feature row 2: delay risk (reversed) ---------- */}
      <section className="mx-auto max-w-content px-6 py-8">
        <FeatureRow
          eyebrow="Late-payment prediction"
          title="See late payments coming"
          body="Every invoice gets a green, amber or red risk dot with the likelihood it'll be paid late, and roughly how many days, in plain language."
          bullets={["Based on vendor history, amount, PO match and approval chain", "Sort and filter your queue by risk"]}
          reverse
        >
          <RiskCard
            compact
            invoiceNumber="INV DS/2026/0883"
            vendor=""
            headline="72% likely to be paid late"
            sub="About 9 days late, based on vendor history"
            risk={72}
            comparisons={[
              { name: "Nizam Foods", pct: 12, tone: "ok" },
              { name: "Greenfield Agro", pct: 48, tone: "warn" },
            ]}
          />
        </FeatureRow>
      </section>

      {/* ---------- Feature row 3: approvals ---------- */}
      <section className="mx-auto max-w-content px-6 py-8">
        <FeatureRow
          eyebrow="Approval trail"
          title="Approvals with a clear trail"
          body="Invoices move from pending to approved or rejected, and every step is recorded on the invoice's timeline."
          bullets={["Roles for finance users, approvers and admins", "Approvers can only act on their own approvals", "Bulk-approve from the invoice list"]}
        >
          <ApprovalCard />
        </FeatureRow>
      </section>

      {/* ---------- Three small tiles ---------- */}
      <section className="mx-auto max-w-content px-6 py-16">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <CsvTile />
            <div className="mt-4 font-display text-base font-semibold text-ink">Bulk import without surprises</div>
            <p className="mt-1 text-sm text-ink-muted">Upload a CSV and see how every row checked first, errors explained in plain English.</p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <DigestTile />
            <div className="mt-4 font-display text-base font-semibold text-ink">A daily overdue digest</div>
            <p className="mt-1 text-sm text-ink-muted">Each morning, past-due invoices are marked overdue and a summary goes to Slack or email.</p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <AskTile />
            <div className="mt-4 font-display text-base font-semibold text-ink">Ask in plain language</div>
            <p className="mt-1 text-sm text-ink-muted">
              &quot;Which invoices are overdue?&quot; or &quot;high-risk invoices this month?&quot; Answers come
              from your live data, with the invoices linked.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- Dashboard mockup ---------- */}
      <section className="mx-auto max-w-content px-6 py-16">
        <h2 className="max-w-[24ch] font-display text-3xl font-bold tracking-tight text-ink sm:text-[40px]">
          Know what you owe, to whom, and what&apos;s at risk
        </h2>
        <p className="mt-3 max-w-[56ch] text-base text-ink-muted">
          One dashboard for pending and overdue invoices, total vendor exposure, and the AI&apos;s
          flags.
        </p>
        <div className="mt-8 rounded-xl border border-line bg-surface p-6 shadow-card">
          <div className="grid grid-cols-2 gap-6 border-b border-line pb-5 sm:grid-cols-4">
            <Stat label="Pending approval" value="14" sub="₹21.8L" />
            <Stat label="Overdue" value="5" sub="₹9.4L" />
            <Stat label="Total vendor exposure" value="₹42.6L" />
            <Stat label="Duplicates to review" value="2" />
          </div>
          <div className="grid grid-cols-1 gap-6 pt-5 lg:grid-cols-[1.5fr_1fr]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted">
                    <th className="pb-2 pr-3 font-medium">Vendor</th>
                    <th className="pb-2 pr-3 font-medium">Invoice</th>
                    <th className="pb-2 pr-3 font-medium">Due</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {DASHBOARD_ROWS.map((r) => (
                    <tr key={r.invoice} className="border-t border-line">
                      <td className="py-2.5 pr-3 text-ink">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${ledgerDot[r.tone]}`} />
                          {r.vendor}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs text-ink-muted">{r.invoice}</td>
                      <td className="py-2.5 pr-3 text-ink-muted">{r.due}</td>
                      <td className="py-2.5 pr-3">
                        <span className={badgeColor[r.tone]}>{r.status}</span>
                      </td>
                      <td className="py-2.5 text-right font-mono text-ink">{r.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-lg border border-line bg-ground p-4">
              <div className="mb-3 text-sm font-semibold text-ink">Vendor exposure</div>
              <div className="space-y-3">
                {VENDOR_EXPOSURE.map((v) => (
                  <div key={v.name}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-ink">{v.name}</span>
                      <span className="font-mono text-ink-muted">{v.amount}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-line">
                      <div
                        className={`h-full rounded-full ${v.tone === "bad" ? "bg-bad-fg" : "bg-ok-fg"}`}
                        style={{ width: `${Math.max(10, (v.raw / 6.4) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-1.5 border-t border-line pt-3 text-xs text-genai">
                <SparkleIcon />
                Ask: &quot;Which vendors are we paying late most often?&quot;
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Try it ---------- */}
      <section className="mx-auto max-w-content px-6 py-8">
        <div className="rounded-xl border border-line bg-surface p-6 shadow-card sm:p-8">
          <div className="mb-1.5 font-display text-lg font-semibold text-ink">Try it — drop a bill in</div>
          <p className="mb-4 text-sm text-ink-muted">Runs right here in your browser. Nothing leaves this page.</p>
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
            className={`flex cursor-pointer flex-col items-center gap-2.5 rounded-lg border border-dashed px-6 py-8 text-center text-sm text-ink-muted transition-colors ${
              dragging ? "border-accent bg-accent-soft" : "border-line hover:border-accent hover:bg-accent-soft/40"
            } ${reading ? "cursor-progress opacity-70" : ""}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.csv,.png,.jpg,.jpeg"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
            <UploadIcon />
            <span>
              {reading
                ? "Reading the file…"
                : result
                  ? "Drag another bill here — or click to choose one"
                  : "Drag a PDF, CSV or image here — or click to choose one"}
            </span>
          </div>

          {result && (
            <div className="mt-4 rounded-lg border border-line bg-ground p-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                <span className="break-all font-mono text-xs text-ink-muted">{result.fileName}</span>
                <span className="text-lg font-semibold text-ink">{result.risk}% delay risk</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone={result.risk >= 55 ? "warn" : "ok"}>
                  {result.risk >= 55 ? `Likely ${result.lateDays} days late` : "Likely on time"}
                </Badge>
                <Badge tone={result.isDup ? "dup" : "ok"}>{result.isDup ? "Possible duplicate" : "No duplicate found"}</Badge>
              </div>
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Why this score</div>
                {result.reasons.map((r) => (
                  <ReasonRow key={r.text} tone={r.tone} text={r.text} />
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ---------- Controls band ---------- */}
      <section id="controls" className="bg-panel-navy px-6 py-16 text-white">
        <div className="relative mx-auto max-w-content overflow-hidden">
          <div className="absolute -right-10 top-1/2 hidden -translate-y-1/2 lg:block">
            <StarburstRing size={220} />
          </div>
          <div className="relative max-w-[62ch]">
            <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-[40px]">Controls your auditors will like</h2>
          </div>
          <div className="relative mt-10 grid grid-cols-1 gap-8 sm:grid-cols-3 lg:max-w-[70ch]">
            {[
              { title: "Role-based access", body: "Finance users capture and pay, approvers sign off, admins see everything. Each role sees only what it should." },
              { title: "Nothing gets deleted", body: "No role can delete an invoice, approval, or payment. Every change leaves a trail." },
              { title: "AI with read-only access", body: "The assistant can only read a fixed set of invoice data. It can't change records, and every flag is reviewed by a person." },
            ].map((p) => (
              <div key={p.title}>
                <div className="mb-2 text-base font-semibold text-white">{p.title}</div>
                <p className="text-sm text-panel-navy-ink">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Pricing ---------- */}
      <section id="pricing" className="mx-auto max-w-content px-6 py-20">
        <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-[40px]">Simple pricing, based on invoice volume</h2>
        <p className="mt-3 max-w-[56ch] text-base text-ink-muted">
          Every plan includes AI extraction, duplicate detection and late-payment prediction.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {PRICING.map((tier) => (
            <div
              key={tier.name}
              className={`flex flex-col rounded-xl border p-6 ${
                tier.highlight ? "border-panel-navy bg-panel-navy text-white" : "border-line bg-surface"
              }`}
            >
              <div className={`font-display text-lg font-semibold ${tier.highlight ? "text-white" : "text-ink"}`}>{tier.name}</div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className={`font-display text-3xl font-bold ${tier.highlight ? "text-white" : "text-ink"}`}>{tier.price}</span>
                {tier.period && <span className={tier.highlight ? "text-panel-navy-ink" : "text-ink-muted"}>{tier.period}</span>}
              </div>
              <p className={`mt-2 text-sm ${tier.highlight ? "text-panel-navy-ink" : "text-ink-muted"}`}>{tier.desc}</p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {tier.features.map((f) => (
                  <li key={f} className={`flex items-start gap-2 text-sm ${tier.highlight ? "text-white/90" : "text-ink"}`}>
                    <span className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full ${tier.highlight ? "bg-white/15" : "bg-ok-bg text-ok-fg"}`}>
                      <CheckIcon small />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={tier.href}
                className={`mt-6 inline-flex h-10 items-center justify-center rounded-lg border text-sm font-semibold ${
                  tier.highlight ? "border-white bg-white text-accent hover:brightness-95" : "border-line bg-ground text-ink hover:border-ink-muted"
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="border-y border-line bg-surface px-6 py-16">
        <div className="mx-auto flex max-w-content flex-col items-center gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-[26ch] text-center lg:text-left">
            <h2 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Catch the next duplicate before it&apos;s paid.</h2>
            <p className="mt-2 text-sm text-ink-muted">Import last month&apos;s supplier invoices as a CSV and see what Qlens flags in a few minutes.</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <Link
                href="/register"
                className="inline-flex h-[46px] items-center rounded-lg border border-accent bg-accent px-6 text-base font-semibold text-accent-ink shadow-[0_1px_2px_rgb(18_63_48/0.3),0_8px_20px_-8px_rgb(18_63_48/0.5)] hover:brightness-105"
              >
                Start free trial
              </Link>
              <Link href="/demo" className="inline-flex h-[46px] items-center rounded-lg border border-line bg-ground px-6 text-base font-semibold text-ink hover:border-ink-muted">
                Book a demo
              </Link>
            </div>
          </div>
          <PaidBadge />
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="px-6 py-8">
        <div className="mx-auto flex max-w-content flex-col items-center justify-between gap-4 sm:flex-row">
          <span className="flex items-center gap-2 font-display text-base font-bold text-ink">
            <QlensMark size={22} />
            Qlens
          </span>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-ink-muted">
            <a href="#features" className="hover:text-ink">Product</a>
            <a href="#pricing" className="hover:text-ink">Pricing</a>
            <a href="#controls" className="hover:text-ink">Security</a>
            <Link href="/login" className="hover:text-ink">Sign in</Link>
          </nav>
          <span className="text-xs text-ink-muted">© 2026 Qlens · invoice intelligence</span>
        </div>
      </footer>
    </div>
  );
}

const ledgerDot: Record<"ok" | "warn" | "bad" | "dup", string> = {
  ok: "bg-ok-fg",
  warn: "bg-warn-fg",
  bad: "bg-bad-fg",
  dup: "bg-dup-fg",
};

const badgeColor: Record<"ok" | "warn" | "bad" | "dup", string> = {
  ok: "text-ok-fg font-medium",
  warn: "text-warn-fg font-medium",
  bad: "text-bad-fg font-medium",
  dup: "text-dup-fg font-medium",
};

function FeatureRow({
  eyebrow,
  title,
  body,
  bullets,
  reverse,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  reverse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`grid grid-cols-1 items-center gap-10 lg:grid-cols-2 ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
      <div className="flex justify-center">{children}</div>
      <div>
        <div className="mb-2 text-sm font-semibold text-accent">{eyebrow}</div>
        <h3 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-[32px]">{title}</h3>
        <p className="mt-3 text-base text-ink-muted">{body}</p>
        <ul className="mt-5 space-y-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-sm text-ink">
              <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-accent" />
              {b}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RiskCard({
  invoiceNumber,
  meta,
  vendor,
  amount,
  sub,
  headline,
  badges,
  risk,
  reasons,
  comparisons,
  compact,
}: {
  invoiceNumber: string;
  meta?: string;
  vendor: string;
  amount?: string;
  sub?: string;
  headline?: string;
  badges?: { tone: "ok" | "warn"; label: string }[];
  risk: number;
  reasons?: { tone: "ok" | "warn"; text: string }[];
  comparisons?: { name: string; pct: number; tone: "ok" | "warn" }[];
  compact?: boolean;
}) {
  return (
    <div className={`w-full rounded-xl border border-line bg-surface p-6 shadow-pop ${compact ? "max-w-[420px]" : ""}`}>
      <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="font-mono text-xs text-ink-muted">
            {invoiceNumber}
            {meta ? ` · ${meta}` : ""}
          </div>
          {vendor && <div className="text-lg font-semibold text-ink">{vendor}</div>}
          {headline && <div className="mt-1 font-display text-lg font-semibold text-ink">{headline}</div>}
          {sub && <div className="mt-0.5 text-xs text-ink-muted">{sub}</div>}
        </div>
        {amount ? (
          <div className="text-right">
            <div className="font-mono text-xl font-semibold text-ink">{amount}</div>
            {sub && !headline && <div className="text-2xs text-ink-muted">{sub}</div>}
          </div>
        ) : (
          <span className="mt-1 h-2.5 w-2.5 flex-none rounded-full bg-bad-fg" />
        )}
      </div>

      {badges && (
        <div className="mt-4 flex flex-wrap gap-2">
          {badges.map((b) => (
            <Badge key={b.label} tone={b.tone}>
              {b.label}
            </Badge>
          ))}
        </div>
      )}

      <div className={badges ? "mt-4" : "mt-4"}>
        {!headline && (
          <div className="mb-1.5 flex justify-between text-xs text-ink-muted">
            <span>Delay risk</span>
            <span className="font-mono font-semibold text-warn-fg">{risk}%</span>
          </div>
        )}
        <div className="relative h-1.5 overflow-hidden rounded-full bg-line">
          {headline ? (
            <div className="flex h-full w-full">
              <div className="h-full bg-ok-fg" style={{ width: "34%" }} />
              <div className="h-full bg-warn-fg" style={{ width: "33%" }} />
              <div className="h-full bg-bad-fg" style={{ width: "33%" }} />
            </div>
          ) : (
            <div className="h-full rounded-full bg-warn-fg/70" style={{ width: `${risk}%` }} />
          )}
        </div>
        {headline && (
          <div className="mt-1 flex justify-between text-2xs text-ink-muted">
            <span>0.34</span>
            <span>0.67</span>
          </div>
        )}
      </div>

      {reasons && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-2.5 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Why this score</div>
          {reasons.map((r) => (
            <ReasonRow key={r.text} tone={r.tone} text={r.text} />
          ))}
        </div>
      )}

      {comparisons && (
        <div className="mt-5 space-y-2 border-t border-line pt-4">
          {comparisons.map((c) => (
            <div key={c.name} className="flex items-center justify-between rounded-lg bg-ground px-3 py-2 text-sm">
              <span className="flex items-center gap-2 text-ink">
                <span className={`h-1.5 w-1.5 rounded-full ${c.tone === "ok" ? "bg-ok-fg" : "bg-warn-fg"}`} />
                {c.name}
              </span>
              <span className="font-mono text-ink-muted">{c.pct}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DuplicateCard() {
  return (
    <div className="w-full max-w-[420px] rounded-xl border border-line bg-surface p-6 shadow-pop">
      <div className="grid grid-cols-2 gap-3">
        <MiniInvoice invoiceNumber="DS/2026/0883" date="14 Sep" amount="₹2,50,000" po="PO-4471" />
        <MiniInvoice invoiceNumber="DS-2026-883" date="16 Sep" amount="₹2,50,000" po="PO-4471" />
      </div>
      <div className="relative -mt-3 flex justify-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border-4 border-surface bg-dup-fg text-2xs font-bold text-white">0.91</span>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Badge tone="dup">Same amount</Badge>
        <Badge tone="dup">Invoice no. 94% similar</Badge>
        <Badge tone="dup">Same PO</Badge>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-lg bg-dup-fg px-3 py-2 text-xs font-semibold text-white"
        >
          Confirm duplicate
        </button>
        <button type="button" className="flex-1 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink">
          Not a duplicate
        </button>
      </div>
    </div>
  );
}

function MiniInvoice({ invoiceNumber, date, amount, po }: { invoiceNumber: string; date: string; amount: string; po: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="font-mono text-2xs text-ink-muted">
        {invoiceNumber} · {date}
      </div>
      <div className="mt-1.5 font-mono text-sm font-semibold text-ink">{amount}</div>
      <div className="text-2xs text-ink-muted">{po}</div>
      <div className="mt-2 h-1 rounded-full bg-line" />
    </div>
  );
}

function ApprovalCard() {
  const steps = [
    { who: "Kavya R.", role: "Finance user · 14 Sep", label: "Submitted by Kavya R.", done: true },
    { who: "Priya Nair", role: "Approver · 15 Sep", label: "Approved by Priya Nair", done: true },
    { who: "₹", role: "₹2,95,000 · 28 Oct", label: "Payment recorded", done: false },
  ];
  return (
    <div className="w-full max-w-[420px] rounded-xl border border-line bg-surface p-6 shadow-pop">
      {steps.map((s, i) => (
        <div key={s.label} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-2xs font-bold ${
                s.done ? "bg-accent text-accent-ink" : "bg-line text-ink-muted"
              }`}
            >
              {s.who === "₹" ? "₹" : s.who.split(" ").map((p) => p[0]).join("")}
            </span>
            {i < steps.length - 1 && <span className="mt-1 h-10 w-px bg-line" />}
          </div>
          <div className="flex-1 pb-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-ink">{s.label}</div>
                <div className="text-xs text-ink-muted">{s.role}</div>
              </div>
              {s.done && (
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-ok-fg text-white">
                  <CheckIcon small />
                </span>
              )}
            </div>
            {!s.done && (
              <span className="mt-2 inline-block rounded-full bg-ground px-2.5 py-1 text-2xs text-ink-muted">Only approvers can approve</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CsvTile() {
  return (
    <div className="rounded-lg border border-line bg-ground p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-display text-sm font-semibold text-ink">invoices_sept.csv</span>
        <span className="rounded-full bg-warn-bg px-2 py-0.5 text-2xs font-semibold text-warn-fg">48 ready · 2 to fix</span>
      </div>
      <div className="space-y-1.5 text-xs">
        <CsvRow ok label="NF-0044" amount="₹1,03,000" />
        <CsvRow ok label="GA-2211" amount="₹1,20,000" />
        <CsvRow label="KT-0139" error="Due date is before invoice date" />
        <CsvRow ok label="SBT-142" amount="₹48,500" />
      </div>
      <button type="button" className="mt-3 w-full rounded-lg bg-panel-navy px-3 py-2 text-xs font-semibold text-white">
        Import 48 invoices
      </button>
    </div>
  );
}

function DigestTile() {
  return (
    <div className="rounded-lg border border-line bg-ground p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-ok-fg text-white">
          <CheckIcon small />
        </span>
        <div>
          <div className="font-display text-sm font-semibold text-ink">Overdue digest</div>
          <div className="text-2xs text-ink-muted">Daily at 7:30 AM · 5 invoices</div>
        </div>
      </div>
      <div className="space-y-2 border-t border-line pt-2.5 text-xs">
        {VENDOR_EXPOSURE.slice(0, 3).map((v) => (
          <div key={v.name} className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-bad-fg" />
              {v.name}
            </span>
            <span className="font-mono font-semibold text-ink">{v.amount}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-1.5">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent">Slack</span>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent">Email</span>
      </div>
    </div>
  );
}

function AskTile() {
  return (
    <div className="rounded-lg border border-line bg-ground p-4">
      <div className="mb-3 inline-flex items-center rounded-full bg-panel-navy px-3 py-1.5 text-2xs font-semibold text-white">
        High-risk invoices this month?
      </div>
      <p className="text-xs text-ink-muted">3 invoices are likely to be paid late, worth ₹7.2L in total.</p>
      <div className="mt-3 space-y-1.5">
        {[
          { name: "Deccan Steel", pct: 72 },
          { name: "Greenfield Agro", pct: 68 },
        ].map((r) => (
          <div key={r.name} className="flex items-center justify-between rounded-md bg-surface px-2.5 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-bad-fg" />
              {r.name}
            </span>
            <span className="font-mono font-semibold text-ink-muted">{r.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Legend({ tone, label }: { tone: "ok" | "warn" | "bad" | "dup"; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${ledgerDot[tone]}`} />
      {label}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-display text-xl font-bold text-ink">{value}</span>
        {sub && <span className="text-xs text-ink-muted">{sub}</span>}
      </div>
    </div>
  );
}

function CsvRow({ label, amount, error, ok }: { label: string; amount?: string; error?: string; ok?: boolean }) {
  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-bad-bg px-2 py-1.5">
        <span className="flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full bg-bad-fg text-[9px] font-bold text-white">!</span>
        <span className="font-mono text-2xs text-ink">{label}</span>
        <span className="text-2xs font-medium text-bad-fg">{error}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1">
      <span className="flex items-center gap-2">
        <span className="flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full bg-ok-fg text-white">
          <CheckIcon small />
        </span>
        <span className="font-mono text-2xs text-ink">{label}</span>
      </span>
      {ok && <span className="font-mono text-2xs text-ink-muted">{amount}</span>}
    </div>
  );
}

function StarburstRing({ size = 200 }: { size?: number }) {
  const n = 40;
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className="text-white/10" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => {
        const angle = (i / n) * Math.PI * 2;
        const x1 = (100 + Math.cos(angle) * 70).toFixed(2);
        const y1 = (100 + Math.sin(angle) * 70).toFixed(2);
        const x2 = (100 + Math.cos(angle) * 96).toFixed(2);
        const y2 = (100 + Math.sin(angle) * 96).toFixed(2);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1.6" />;
      })}
    </svg>
  );
}

function PaidBadge() {
  return (
    <div className="relative flex h-40 w-40 flex-none items-center justify-center">
      <svg viewBox="0 0 160 160" className="absolute inset-0 h-full w-full text-ok-fg/25" aria-hidden="true">
        {Array.from({ length: 32 }).map((_, i) => {
          const angle = (i / 32) * Math.PI * 2;
          const x1 = (80 + Math.cos(angle) * 58).toFixed(2);
          const y1 = (80 + Math.sin(angle) * 58).toFixed(2);
          const x2 = (80 + Math.cos(angle) * 78).toFixed(2);
          const y2 = (80 + Math.sin(angle) * 78).toFixed(2);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1.4" />;
        })}
      </svg>
      <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-panel-navy text-center text-white">
        <span className="font-display text-base font-bold tracking-wide">PAID</span>
        <span className="text-[10px] text-panel-navy-ink">in 11 days</span>
      </div>
      <span className="absolute right-1 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-dup-fg text-white">
        <CheckIcon small />
      </span>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" />
    </svg>
  );
}

function CheckIcon({ small }: { small?: boolean }) {
  const s = small ? 9 : 13;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12.5 9 18l11-12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReasonRow({ tone, text }: { tone: "ok" | "warn"; text: string }) {
  return (
    <div className="flex items-center gap-3 py-1 text-sm text-ink">
      <span
        className={`flex h-5 w-5 flex-none items-center justify-center rounded text-xs font-bold ${
          tone === "warn" ? "bg-warn-bg text-warn-fg" : "bg-ok-bg text-ok-fg"
        }`}
      >
        {tone === "warn" ? "+" : "–"}
      </span>
      {text}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="24" height="24" aria-hidden="true">
      <path d="M12 15V4m0 0 4 4m-4-4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
