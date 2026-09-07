import { cn } from "@/lib/cn";
import { toneClasses, toneRule, type Tone } from "@/lib/status";

/**
 * Block-level status message — form error, load failure, success note. The
 * box-shaped sibling of Badge: same tone vocabulary, a 2px status rule on the
 * left (matching StatStrip's top rule) instead of a full border.
 */
export function Callout({
  tone = "bad",
  className,
  children,
}: {
  tone?: Extract<Tone, "ok" | "warn" | "bad">;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={cn("border-l-2 px-3 py-2 text-sm", toneClasses[tone], toneRule[tone], className)}
    >
      {children}
    </div>
  );
}
