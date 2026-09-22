"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { inr, inrCompact } from "@/lib/format";

interface Row {
  vendorId: string;
  vendorName: string;
  outstanding: number;
}

/** Drop the corporate suffix and cap length so the axis stays one line per row. */
function display(name: string): string {
  const t = name
    .replace(/\s+(Pvt\.?\s+)?Ltd\.?$/i, "")
    .replace(/\s+Limited$/i, "")
    .trim();
  return t.length > 22 ? `${t.slice(0, 21)}…` : t;
}

function VendorTick({ x, y, payload }: { x: number; y: number; payload: { value: string } }) {
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={12} fill="var(--ink)">
      <title>{payload.value}</title>
      {display(payload.value)}
    </text>
  );
}

/** Outstanding balance per vendor. Clicking a bar filters the page to that vendor. */
export function ExposureBarChart({
  data,
  selectedVendorId,
  onSelect,
}: {
  data: Row[];
  selectedVendorId?: string | null;
  onSelect: (vendorId: string | null) => void;
}) {
  const rows = [...data].sort((a, b) => b.outstanding - a.outstanding);

  return (
    <div style={{ width: "100%", height: Math.max(200, rows.length * 40 + 44) }}>
      <ResponsiveContainer>
        <BarChart
          layout="vertical"
          data={rows}
          barCategoryGap="32%"
          margin={{ left: 4, right: 64, top: 4, bottom: 8 }}
        >
          <CartesianGrid horizontal={false} stroke="var(--line)" />
          <XAxis
            type="number"
            tickFormatter={(v) => inrCompact(v)}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
          />
          <YAxis
            type="category"
            dataKey="vendorName"
            width={180}
            interval={0}
            tickLine={false}
            axisLine={false}
            tick={(props) => <VendorTick {...props} />}
          />
          <Tooltip
            cursor={{ fill: "var(--accent)", fillOpacity: 0.06 }}
            formatter={(v: number) => [inr(v), "Outstanding"]}
            labelFormatter={(l) => l}
            labelStyle={{ color: "var(--ink)", fontWeight: 600, marginBottom: 2 }}
            contentStyle={{
              fontSize: 12,
              border: "1px solid var(--line)",
              borderRadius: 10,
              boxShadow: "0 8px 24px -12px rgb(20 24 31 / 0.2)",
            }}
          />
          <Bar
            dataKey="outstanding"
            radius={[0, 4, 4, 0]}
            maxBarSize={20}
            cursor="pointer"
            isAnimationActive={false}
            onClick={(entry: any) =>
              onSelect(entry?.vendorId === selectedVendorId ? null : entry?.vendorId ?? null)
            }
          >
            {rows.map((r) => (
              <Cell
                key={r.vendorId}
                fill={
                  !selectedVendorId || selectedVendorId === r.vendorId
                    ? "var(--accent)"
                    : "#c6cbd4"
                }
              />
            ))}
            <LabelList
              dataKey="outstanding"
              position="right"
              offset={8}
              formatter={(v: number) => inrCompact(v)}
              style={{ fontSize: 11, fill: "var(--ink-muted)", fontVariantNumeric: "tabular-nums" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
