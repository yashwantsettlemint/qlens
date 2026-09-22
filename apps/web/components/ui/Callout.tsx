import { cn } from "@/lib/cn";
import { toneClasses, type Tone } from "@/lib/status";

/**
 * Block-level status message — form error, load failure, success note. The
 * box-shaped sibling of Badge: same tone vocabulary, as a filled rounded block.
 */
export function Callout({
  tone = "bad",
  className,
  children,
}: {
  tone?: Extract<Tone, "ok" | "warn" | "bad" | "dup">;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={cn("rounded-lg px-3.5 py-2.5 text-sm", toneClasses[tone], className)}
    >
      {children}
    </div>
  );
}
