import type { StatusView, Tone } from "./status";

/** Delay-risk thresholds on delayProbability. One source for the colour dots. */
export const RISK_THRESHOLDS = { green: 0.34, amber: 0.67 } as const;

export type RiskLevel = "low" | "medium" | "high";

export function riskLevel(prob: number): RiskLevel {
  if (prob < RISK_THRESHOLDS.green) return "low";
  if (prob < RISK_THRESHOLDS.amber) return "medium";
  return "high";
}

export function riskTone(prob: number): StatusView {
  const level = riskLevel(prob);
  const map: Record<RiskLevel, Tone> = { low: "ok", medium: "warn", high: "bad" };
  return { tone: map[level], label: `${Math.round(prob * 100)}%` };
}

export interface DelayPredictionLike {
  delayProbability: number;
  predictedDelayDays: number;
}

/** One-line, plain-language reading of a delay prediction. */
export function riskNote(pred: DelayPredictionLike, vendorName?: string): string {
  const chance = Math.round(pred.delayProbability * 100);
  const driver =
    pred.delayProbability >= RISK_THRESHOLDS.amber
      ? `mainly ${vendorName ? `${vendorName}'s` : "the vendor's"} payment history and month-end approval load`
      : "a few days of slack against the payment terms";
  return `This invoice has a ${chance}% chance of being paid late, about ${pred.predictedDelayDays} day${
    pred.predictedDelayDays === 1 ? "" : "s"
  } past due — ${driver}.`;
}
