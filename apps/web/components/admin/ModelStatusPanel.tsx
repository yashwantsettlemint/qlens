"use client";

import { useQuery } from "@apollo/client";
import { MlModelStatusQuery } from "@/graphql/operations/queries";
import { Panel } from "@/components/ui/Panel";
import { StatStrip, Stat } from "@/components/ui/StatStrip";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const num = (v: number | null | undefined, suffix = "") => (v == null ? "—" : `${v}${suffix}`);

function ModelCard({
  title,
  model,
}: {
  title: string;
  model: {
    status: string;
    method: string;
    modelVersion?: string | null;
    trainedAt?: string | null;
    nRows?: number | null;
    featureCount?: number | null;
    threshold?: number | null;
    metrics?: {
      rocAuc?: number | null;
      accuracy?: number | null;
      precision?: number | null;
      recall?: number | null;
      maeDays?: number | null;
      r2?: number | null;
    } | null;
  };
}) {
  const trained = model.status === "trained";
  const m = model.metrics;

  return (
    <Panel
      title={title}
      actions={
        <Badge tone={trained ? "ok" : "warn"}>
          {trained ? `ML — ${model.method}` : `fallback — ${model.method}`}
        </Badge>
      }
    >
      {!trained ? (
        <Callout tone="warn">
          No trained model on disk — serving the {model.method} fallback. Run the training
          command for this model, then restart ml-service.
        </Callout>
      ) : (
        <>
          <StatStrip cols={4}>
            <Stat label="ROC-AUC" value={pct(m?.rocAuc)} />
            <Stat label="Accuracy" value={pct(m?.accuracy)} />
            <Stat label="Precision" value={pct(m?.precision)} />
            <Stat label="Recall" value={pct(m?.recall)} />
          </StatStrip>
          {(m?.maeDays != null || m?.r2 != null) && (
            <div className="mt-3">
              <StatStrip cols={2}>
                <Stat label="MAE (days late)" value={num(m?.maeDays, "d")} />
                <Stat label="R²" value={m?.r2 == null ? "—" : m.r2.toFixed(3)} />
              </StatStrip>
            </div>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-ink-muted">Version</dt>
              <dd className="tabular text-ink">{model.modelVersion ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Trained on</dt>
              <dd className="tabular text-ink">{num(model.nRows, " rows")}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Features</dt>
              <dd className="tabular text-ink">{num(model.featureCount)}</dd>
            </div>
            {model.threshold != null && (
              <div>
                <dt className="text-ink-muted">Decision threshold</dt>
                <dd className="tabular text-ink">{model.threshold}</dd>
              </div>
            )}
            <div>
              <dt className="text-ink-muted">Trained at</dt>
              <dd className="tabular text-ink">
                {model.trainedAt ? new Date(model.trainedAt).toLocaleString() : "—"}
              </dd>
            </div>
          </dl>
        </>
      )}
    </Panel>
  );
}

/** Admin-only technical status for both ML models — accuracy/precision/recall
 * plus version/training metadata, read live from ml-service's GET /models. */
export function ModelStatusPanel() {
  const { data, loading, error } = useQuery(MlModelStatusQuery);

  if (loading) return null;
  if (error) return <Callout tone="bad">Couldn’t load model status: {error.message}</Callout>;
  if (!data?.mlModelStatus) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ModelCard title="Duplicate detection model" model={data.mlModelStatus.duplicate} />
      <ModelCard title="Delay prediction model" model={data.mlModelStatus.delay} />
    </div>
  );
}
