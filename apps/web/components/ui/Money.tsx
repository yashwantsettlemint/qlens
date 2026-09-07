import { cn } from "@/lib/cn";
import { inr } from "@/lib/format";

/** Monetary value — always mono + tabular so columns align on the digits. */
export function Money({ value, className }: { value: number; className?: string }) {
  return <span className={cn("tabular", className)}>{inr(value)}</span>;
}
