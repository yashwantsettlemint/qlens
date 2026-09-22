"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { riskLevel, type RiskLevel } from "@/lib/risk";
import type { InvoiceRow } from "@/lib/types";

const BUCKETS: { level: RiskLevel; label: string; color: string }[] = [
  { level: "low", label: "Low risk", color: "var(--ok-fg)" },
  { level: "medium", label: "Medium risk", color: "var(--warn-fg)" },
  { level: "high", label: "High risk", color: "var(--bad-fg)" },
];

/** Open invoices bucketed by delay-risk band (from delayProbability) — a
 * finance-facing counterpart to the admin ML panels, using the same
 * riskLevel() thresholds as the RiskDot everyone already sees per-row. */
export function DelayRiskChart({ invoices }: { invoices: InvoiceRow[] }) {
  const withRisk = invoices.filter((i) => i.delayPrediction != null);
  const counts = { low: 0, medium: 0, high: 0 };
  for (const inv of withRisk) {
    counts[riskLevel(inv.delayPrediction!.delayProbability)]++;
  }
  const data = BUCKETS.map((b) => ({ ...b, count: counts[b.level] }));

  if (withRisk.length === 0) {
    return <p className="text-sm text-ink-muted">No delay predictions on open invoices yet.</p>;
  }

  return (
    <div style={{ width: "100%", height: 160 }}>
      <ResponsiveContainer>
        <BarChart layout="vertical" data={data} barCategoryGap="28%" margin={{ left: 4, right: 32, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="var(--line)" />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={90}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--ink)" }}
          />
          <Tooltip
            cursor={{ fill: "var(--ink)", fillOpacity: 0.04 }}
            formatter={(v: number) => [v, "Invoices"]}
            contentStyle={{ fontSize: 12, border: "1px solid var(--line)", borderRadius: 10 }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.level} fill={d.color} />
            ))}
            <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: "var(--ink-muted)" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
