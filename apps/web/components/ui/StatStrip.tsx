import { cn } from "@/lib/cn";
import { toneRule, type Tone } from "@/lib/status";

/**
 * A row of summary figures divided by hairlines — deliberately not a set of
 * shadowed cards. A stat carrying a warning gets a 2px status-coloured top rule.
 */
const COLS = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" } as const;

export function StatStrip({
  children,
  cols = 3,
}: {
  children: React.ReactNode;
  cols?: keyof typeof COLS;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 divide-y divide-line border border-line bg-surface sm:divide-x sm:divide-y-0",
        COLS[cols],
      )}
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  rule = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  rule?: Tone;
}) {
  return (
    <div
      className={cn(
        "px-4 py-3.5",
        rule !== "neutral" && "border-t-2",
        rule !== "neutral" && toneRule[rule],
      )}
    >
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="tabular mt-1 text-2xl font-medium text-ink">{value}</div>
      {hint != null && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}
