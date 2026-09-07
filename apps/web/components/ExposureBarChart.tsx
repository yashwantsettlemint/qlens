"use client";

import {
  Bar,
  BarChart,
  Cell,
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
    <div style={{ width: "100%", height: Math.max(160, rows.length * 34 + 24) }}>
      <ResponsiveContainer>
        <BarChart layout="vertical" data={rows} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <XAxis
            type="number"
            tickFormatter={(v) => inrCompact(v)}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            stroke="var(--line)"
          />
          <YAxis
            type="category"
            dataKey="vendorName"
            width={150}
            tick={{ fontSize: 11, fill: "var(--ink)" }}
            stroke="var(--line)"
          />
          <Tooltip
            cursor={{ fill: "var(--ground)" }}
            formatter={(v: number) => [inr(v), "Outstanding"]}
            contentStyle={{
              fontSize: 12,
              border: "1px solid var(--line)",
              borderRadius: 4,
            }}
          />
          <Bar
            dataKey="outstanding"
            radius={[0, 2, 2, 0]}
            cursor="pointer"
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
                    : "#bcd3e6"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
