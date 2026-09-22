import { Panel } from "@/components/ui/Panel";
import { RiskDot } from "@/components/ui/RiskDot";
import { ExplanationList } from "@/components/ui/ExplanationList";
import { riskNote } from "@/lib/risk";
import type { InvoiceDetail } from "@/lib/types";

export function DelayPanel({
  pred,
  vendorName,
}: {
  pred: NonNullable<InvoiceDetail["delayPrediction"]>;
  vendorName: string;
}) {
  return (
    <Panel title="Delay risk">
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <RiskDot pred={pred} withLabel />
        </div>
        <div>
          <p className="text-sm leading-relaxed text-ink">{riskNote(pred, vendorName)}</p>
          <p className="mt-1 text-xs text-ink-muted">Model {pred.modelVersion}</p>
        </div>
      </div>
      <ExplanationList items={pred.explanation} />
    </Panel>
  );
}
