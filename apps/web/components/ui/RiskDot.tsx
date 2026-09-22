import { cn } from "@/lib/cn";
import { riskTone, type DelayPredictionLike } from "@/lib/risk";
import { toneDot } from "@/lib/status";

/**
 * Delay-risk indicator: green / amber / red by delayProbability, labeled by
 * predicted days late (the number finance actually acts on) — never the
 * traffic-light tones only, other than duplicate violet.
 */
export function RiskDot({
  pred,
  withLabel = false,
}: {
  pred: DelayPredictionLike | null | undefined;
  withLabel?: boolean;
}) {
  if (pred == null) return <span className="text-ink-muted">—</span>;
  const v = riskTone(pred);
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`${Math.round(pred.delayProbability * 100)}% chance of late payment, ~${pred.predictedDelayDays}d`}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", toneDot[v.tone])} />
      {withLabel && <span className="tabular text-xs">{v.label}</span>}
    </span>
  );
}
