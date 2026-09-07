/**
 * The status vocabulary, defined once. Every badge/dot/rule colour in the app
 * comes from here — never a hex literal in a component. `dup` (violet) is
 * deliberately outside the ok/warn/bad traffic-light scale so a duplicate flag
 * is never read as a delay-risk level.
 */
export type Tone = "ok" | "warn" | "bad" | "dup" | "neutral";

export interface StatusView {
  tone: Tone;
  label: string;
}

export function approvalTone(status: string): StatusView {
  switch (status) {
    case "APPROVED":
      return { tone: "ok", label: "Approved" };
    case "REJECTED":
      return { tone: "bad", label: "Rejected" };
    default:
      return { tone: "warn", label: "Pending" };
  }
}

export function paymentTone(status: string): StatusView {
  switch (status) {
    case "PAID":
      return { tone: "ok", label: "Paid" };
    case "OVERDUE":
      return { tone: "bad", label: "Overdue" };
    default:
      return { tone: "neutral", label: "Unpaid" };
  }
}

/** Ageing bucket for an overdue invoice: >30d red, 1–30d amber, else neutral. */
export function daysOverdueTone(days: number): StatusView {
  if (days > 30) return { tone: "bad", label: `${days}d` };
  if (days >= 1) return { tone: "warn", label: `${days}d` };
  return { tone: "neutral", label: "—" };
}

export const duplicateTone: StatusView = { tone: "dup", label: "Duplicate" };

export function reviewedStatusLabel(status: string): string {
  switch (status) {
    case "confirmed_duplicate":
      return "Confirmed duplicate";
    case "false_positive":
      return "Cleared — not a duplicate";
    default:
      return "Awaiting review";
  }
}

/** Tailwind classes per tone — the single place tones become colour. */
export const toneClasses: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok-fg",
  warn: "bg-warn-bg text-warn-fg",
  bad: "bg-bad-bg text-bad-fg",
  dup: "bg-dup-bg text-dup-fg",
  neutral: "bg-line/60 text-ink-muted",
};

export const toneDot: Record<Tone, string> = {
  ok: "bg-ok-fg",
  warn: "bg-warn-fg",
  bad: "bg-bad-fg",
  dup: "bg-dup-fg",
  neutral: "bg-ink-muted",
};

export const toneRule: Record<Tone, string> = {
  ok: "border-ok-fg",
  warn: "border-warn-fg",
  bad: "border-bad-fg",
  dup: "border-dup-fg",
  neutral: "border-line",
};
