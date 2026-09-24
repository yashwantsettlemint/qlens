"use client";

import { useMutation, useQuery } from "@apollo/client";
import { MlRetrainHistoryQuery } from "@/graphql/operations/queries";
import { TriggerModelRetrainMutation } from "@/graphql/operations/mutations";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import type { Tone } from "@/lib/status";

const STATUS_TONE: Record<string, Tone> = {
  succeeded: "ok",
  running: "warn",
  failed: "bad",
  skipped_insufficient_data: "neutral",
};

/** Admin-only retrain audit trail + manual "Retrain now" per model. Sits next
 * to ModelDriftPanel in Settings — retraining is also auto-triggered by
 * drift (see ml-service app/drift.py check_all_drift). */
export function RetrainHistoryPanel() {
  const { data, loading, error, refetch } = useQuery(MlRetrainHistoryQuery, {
    variables: { limit: 20 },
    fetchPolicy: "cache-and-network",
  });
  const [retrain, { loading: retraining }] = useMutation(TriggerModelRetrainMutation, {
    onCompleted: () => refetch(),
    // ModelStatusPanel (the version/rows/metrics cards) has its own separate
    // query and no other way to know a retrain just happened — without this,
    // it keeps showing the pre-retrain model until a hard page reload.
    refetchQueries: ["MlModelStatus"],
  });

  if (loading && !data) return null;
  if (error) return <Callout tone="bad">Couldn’t load retrain history: {error.message}</Callout>;
  const events = data?.mlRetrainHistory ?? [];

  return (
    <Panel
      title="Retrain history"
      actions={
        <div className="flex gap-2">
          <Button disabled={retraining} onClick={() => retrain({ variables: { modelName: "duplicate" } })}>
            {retraining ? "Retraining…" : "Retrain duplicate"}
          </Button>
          <Button disabled={retraining} onClick={() => retrain({ variables: { modelName: "delay" } })}>
            {retraining ? "Retraining…" : "Retrain delay"}
          </Button>
        </div>
      }
    >
      {events.length === 0 ? (
        <p className="text-sm text-ink-muted">No retrain events yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {events.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <span className="font-medium text-ink">{e.modelName}</span>{" "}
                <span className="text-xs text-ink-muted">via {e.triggeredBy}</span>
                <p className="text-xs text-ink-muted">
                  {new Date(e.startedAt).toLocaleString()}
                  {e.oldVersion && e.newVersion && e.oldVersion !== e.newVersion && (
                    <> · {e.oldVersion} → {e.newVersion}</>
                  )}
                </p>
                {e.error && <p className="mt-0.5 text-xs text-bad-fg">{e.error}</p>}
              </div>
              <Badge tone={STATUS_TONE[e.status] ?? "neutral"}>{e.status.replace(/_/g, " ")}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
