import { cn } from "@/lib/cn";
import { riskTone } from "@/lib/risk";
import { toneDot } from "@/lib/status";

/**
 * Delay-risk indicator: green / amber / red by delayProbability. Uses the
 * traffic-light tones only — never the duplicate violet.
 */
export function RiskDot({
  probability,
  withLabel = false,
}: {
  probability: number | null | undefined;
  withLabel?: boolean;
}) {
  if (probability == null) return <span className="text-ink-muted">—</span>;
  const v = riskTone(probability);
  return (
    <span className="inline-flex items-center gap-1.5" title={`${v.label} chance of late payment`}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", toneDot[v.tone])} />
      {withLabel && <span className="tabular text-xs">{v.label}</span>}
    </span>
  );
}
