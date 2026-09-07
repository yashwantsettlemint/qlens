import { cn } from "@/lib/cn";
import {
  approvalTone,
  paymentTone,
  daysOverdueTone,
  duplicateTone,
  toneClasses,
  type Tone,
} from "@/lib/status";

export function Badge({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ApprovalBadge({ status }: { status: string }) {
  const v = approvalTone(status);
  return <Badge tone={v.tone}>{v.label}</Badge>;
}

export function PaymentBadge({ status }: { status: string }) {
  const v = paymentTone(status);
  return <Badge tone={v.tone}>{v.label}</Badge>;
}

/** Days-overdue pill: red >30d, amber 1–30d. */
export function OverdueBadge({ days }: { days: number }) {
  const v = daysOverdueTone(days);
  if (v.tone === "neutral") return <span className="text-ink-muted">—</span>;
  return <Badge tone={v.tone}>{v.label}</Badge>;
}

export function DuplicateBadge() {
  return <Badge tone={duplicateTone.tone}>{duplicateTone.label}</Badge>;
}
