import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import { fmtDateTime, titleCase } from "@/lib/format";
import { toneDot, type Tone } from "@/lib/status";
import type { InvoiceDetail } from "@/lib/types";

const ACTION_TONE: Record<string, Tone> = {
  submitted: "neutral",
  approved: "ok",
  rejected: "bad",
};

export function ApprovalTimeline({ events }: { events: InvoiceDetail["approvalEvents"] }) {
  return (
    <Panel title="Approval timeline">
      <ol className="space-y-3">
        {events.map((e) => (
          <li key={e.id} className="flex gap-3 text-sm">
            <span
              className={cn(
                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                toneDot[ACTION_TONE[e.action] ?? "neutral"],
              )}
            />
            <div>
              <div className="text-ink">
                <span className="font-medium">{titleCase(e.action)}</span> by {e.actor}
              </div>
              <div className="tabular text-xs text-ink-muted">{fmtDateTime(e.at)}</div>
              {e.note && <div className="mt-0.5 text-xs text-ink-muted">“{e.note}”</div>}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
