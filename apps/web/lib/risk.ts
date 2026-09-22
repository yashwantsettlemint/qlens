import type { StatusView, Tone } from "./status";

/** Delay-risk thresholds on delayProbability. One source for the colour dots. */
export const RISK_THRESHOLDS = { green: 0.34, amber: 0.67 } as const;

export type RiskLevel = "low" | "medium" | "high";

export function riskLevel(prob: number): RiskLevel {
  if (prob < RISK_THRESHOLDS.green) return "low";
  if (prob < RISK_THRESHOLDS.amber) return "medium";
  return "high";
}

export interface DelayPredictionLike {
  delayProbability: number;
  predictedDelayDays: number;
}

/** Tone still comes from delayProbability (the model's confidence band); the
 * visible label leads with the day count, which is what a finance user
 * actually acts on ("3d late" vs. an abstract "50% chance"). */
export function riskTone(pred: DelayPredictionLike): StatusView {
  const level = riskLevel(pred.delayProbability);
  const map: Record<RiskLevel, Tone> = { low: "ok", medium: "warn", high: "bad" };
  const days = pred.predictedDelayDays;
  return { tone: map[level], label: days > 0 ? `${days}d late` : "on time" };
}

/** One-line, plain-language reading of a delay prediction. */
export function riskNote(pred: DelayPredictionLike, vendorName?: string): string {
  const chance = Math.round(pred.delayProbability * 100);
  const driver =
    pred.delayProbability >= RISK_THRESHOLDS.amber
      ? `mainly ${vendorName ? `${vendorName}'s` : "the vendor's"} payment history and month-end approval load`
      : "a few days of slack against the payment terms";
  return `This invoice is predicted to run about ${pred.predictedDelayDays} day${
    pred.predictedDelayDays === 1 ? "" : "s"
  } past due (${chance}% chance of being paid late) — ${driver}.`;
}
