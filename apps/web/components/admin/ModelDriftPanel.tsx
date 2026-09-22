"use client";

import { useQuery, useMutation } from "@apollo/client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MlDriftStatusQuery } from "@/graphql/operations/queries";
import { TriggerDriftCheckMutation } from "@/graphql/operations/mutations";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";

const TITLES: Record<string, string> = { duplicate: "Duplicate detection", delay: "Delay prediction" };

interface DriftReport {
  modelName: string;
  checkedAt: string;
  driftDetected: boolean;
  featurePsiJson: string;
  rollingMetricsJson: string;
  notes?: string | null;
}

function DriftCard({ report }: { report: DriftReport }) {
  const featurePsi: Record<string, number> = JSON.parse(report.featurePsiJson || "{}");
  const rolling = JSON.parse(report.rollingMetricsJson || "{}");
  const psiRows = Object.entries(featurePsi)
    .map(([feature, psi]) => ({ feature, psi }))
    .sort((a, b) => b.psi - a.psi);

  return (
    <Panel
      title={TITLES[report.modelName] ?? report.modelName}
      actions={
        <Badge tone={report.driftDetected ? "bad" : "ok"}>
          {report.driftDetected ? "drift detected" : "stable"}
        </Badge>
      }
    >
      <p className="text-xs text-ink-muted">
        Last checked {report.checkedAt ? new Date(report.checkedAt).toLocaleString() : "—"}
        {rolling.status === "ok" && rolling.n_rows != null && ` · ${rolling.n_rows} recent rows scored`}
      </p>
      {report.notes && (
        <p className="mt-2 text-xs text-ink">{report.notes}</p>
      )}
      {psiRows.length > 0 && (
        <div className="mt-3" style={{ width: "100%", height: Math.max(120, psiRows.length * 28 + 24) }}>
          <ResponsiveContainer>
            <BarChart layout="vertical" data={psiRows} margin={{ left: 4, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid horizontal={false} stroke="var(--line)" />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
              />
              <YAxis
                type="category"
                dataKey="feature"
                width={130}
                tick={{ fontSize: 11, fill: "var(--ink)" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(v: number) => [v.toFixed(3), "PSI"]}
                contentStyle={{ fontSize: 12, border: "1px solid var(--line)", borderRadius: 10 }}
              />
              <Bar dataKey="psi" radius={[0, 4, 4, 0]} maxBarSize={16} fill="var(--accent)" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

/** Admin-only drift monitoring — feature Population Stability Index per model
 * plus rolling performance vs. what was recorded at training time. Sits next
 * to ModelStatusPanel in Settings. */
export function ModelDriftPanel() {
  const { data, loading, error, refetch } = useQuery(MlDriftStatusQuery, {
    fetchPolicy: "cache-and-network",
  });
  const [triggerCheck, { loading: checking }] = useMutation(TriggerDriftCheckMutation, {
    onCompleted: () => refetch(),
  });

  if (loading && !data) return null;
  if (error) return <Callout tone="bad">Couldn’t load drift status: {error.message}</Callout>;
  const reports = data?.mlDriftStatus ?? [];
  if (reports.length === 0) {
    return (
      <Callout tone="warn">
        No drift report yet — the daily check hasn’t run. Trigger one manually below.
        <div className="mt-2">
          <Button disabled={checking} onClick={() => triggerCheck()}>
            {checking ? "Checking…" : "Check drift now"}
          </Button>
        </div>
      </Callout>
    );
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button disabled={checking} onClick={() => triggerCheck()}>
          {checking ? "Checking…" : "Check drift now"}
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {reports.map((r) => (
          <DriftCard key={r.modelName} report={r} />
        ))}
      </div>
    </div>
  );
}
