"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { inr, inrCompact } from "@/lib/format";

interface Bucket {
  label: string;
  inflow: number;
  outflow: number;
  net: number;
}

/** Inflow vs. outflow per forecast window, plus a running net line. Buckets are
 * already model-driven (each invoice lands by due date + predicted delay where
 * scored), so this is the "prediction graph" view of cashForecast. */
export function ForecastChart({ buckets }: { buckets: Bucket[] }) {
  const data = buckets.reduce<(Bucket & { cumulative: number })[]>((acc, b) => {
    const running = (acc.at(-1)?.cumulative ?? 0) + b.net;
    acc.push({ ...b, cumulative: running });
    return acc;
  }, []);

  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
          />
          <YAxis
            tickFormatter={(v) => inrCompact(v)}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            formatter={(v: number, name: string) => [inr(v), name]}
            labelStyle={{ color: "var(--ink)", fontWeight: 600, marginBottom: 2 }}
            contentStyle={{
              fontSize: 12,
              border: "1px solid var(--line)",
              borderRadius: 10,
              boxShadow: "0 8px 24px -12px rgb(20 24 31 / 0.2)",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="inflow" name="Inflow" fill="var(--ok-fg)" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="outflow" name="Outflow" fill="var(--bad-fg)" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Line
            type="monotone"
            dataKey="cumulative"
            name="Cumulative net"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
