import { cn } from "@/lib/cn";
import { toneClasses, type Tone } from "@/lib/status";

/**
 * A row of summary tiles. Each is a rounded card; one carrying a non-neutral
 * `rule` is filled with that status tint (e.g. overdue = red) so it reads at a
 * glance against its plain-white siblings.
 */
const COLS = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" } as const;

export function StatStrip({
  children,
  cols = 3,
}: {
  children: React.ReactNode;
  cols?: keyof typeof COLS;
}) {
  return <div className={cn("grid grid-cols-1 gap-3", COLS[cols])}>{children}</div>;
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
  const tinted = rule !== "neutral";
  return (
    <div
      className={cn(
        "rounded-xl border p-5",
        tinted
          ? cn(toneClasses[rule], "border-transparent")
          : "border-line bg-surface shadow-card",
      )}
    >
      <div className={cn("text-sm", tinted ? "opacity-80" : "text-ink-muted")}>{label}</div>
      <div
        className={cn(
          "tabular mt-1.5 text-3xl font-semibold tracking-tight",
          !tinted && "text-ink",
        )}
      >
        {value}
      </div>
      {hint != null && (
        <div className={cn("mt-1 text-xs", tinted ? "opacity-75" : "text-ink-muted")}>{hint}</div>
      )}
    </div>
  );
}
