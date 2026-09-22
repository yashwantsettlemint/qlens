import { cn } from "@/lib/cn";

export interface FeatureContributionLike {
  feature: string;
  label: string;
  value: number;
  contribution: number;
  direction: string;
}

/**
 * Explainable-AI breakdown for one prediction — the model's own top feature
 * contributions (XGBoost pred_contribs), not a hand-written summary. Shared
 * by DelayPanel and DuplicateCallout.
 */
export function ExplanationList({ items }: { items: FeatureContributionLike[] | null | undefined }) {
  if (!items || items.length === 0) return null;
  const max = Math.max(...items.map((i) => Math.abs(i.contribution)), 0.0001);

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-xs font-medium text-ink-muted">Why</p>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((it) => (
          <li key={it.feature} className="flex items-center gap-2 text-xs">
            <span className="w-36 shrink-0 truncate text-ink-muted" title={it.label}>
              {it.label}
            </span>
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line">
              <span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  it.direction === "increases" ? "bg-bad-fg/70" : "bg-ok-fg/70",
                )}
                style={{ width: `${Math.max(6, (Math.abs(it.contribution) / max) * 100)}%` }}
              />
            </span>
            <span className="tabular w-14 shrink-0 text-right text-ink-muted">
              {it.contribution > 0 ? "+" : ""}
              {it.contribution.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
