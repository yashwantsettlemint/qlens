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
import { riskLevel, type RiskLevel } from "@/lib/risk";
import type { InvoiceRow } from "@/lib/types";

const RISK_COLOR: Record<RiskLevel, string> = {
  low: "var(--ok-fg)",
  medium: "var(--warn-fg)",
  high: "var(--bad-fg)",
};
const RISK_LABEL: Record<RiskLevel, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

interface Row {
  customerId: string;
  customerName: string;
  outstanding: number;
  avgDelayProbability: number;
  invoiceCount: number;
  level: RiskLevel;
}

function display(name: string): string {
  const t = name.replace(/\s+(Pvt\.?\s+)?Ltd\.?$/i, "").replace(/\s+Limited$/i, "").trim();
  return t.length > 22 ? `${t.slice(0, 21)}…` : t;
}

function CustomerTick({ x, y, payload }: { x: number; y: number; payload: { value: string } }) {
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={12} fill="var(--ink)">
      <title>{payload.value}</title>
      {display(payload.value)}
    </text>
  );
}

/** Outstanding receivable per customer, coloured by that customer's average
 * predicted late-payment risk — who we're most exposed to, and how likely
 * they are to pay late. */
export function CustomerExposureDelayChart({ invoices }: { invoices: InvoiceRow[] }) {
  const byCustomer = new Map<string, { name: string; outstanding: number; probs: number[] }>();
  for (const inv of invoices) {
    if (!inv.customer) continue;
    const entry = byCustomer.get(inv.customer.id) ?? {
      name: inv.customer.name,
      outstanding: 0,
      probs: [],
    };
    entry.outstanding += inv.amount + inv.taxAmount;
    if (inv.delayPrediction) entry.probs.push(inv.delayPrediction.delayProbability);
    byCustomer.set(inv.customer.id, entry);
  }

  const rows: Row[] = Array.from(byCustomer.entries())
    .map(([customerId, v]) => {
      const avg = v.probs.length ? v.probs.reduce((a, b) => a + b, 0) / v.probs.length : 0;
      return {
        customerId,
        customerName: v.name,
        outstanding: v.outstanding,
        avgDelayProbability: avg,
        invoiceCount: v.probs.length,
        level: riskLevel(avg),
      };
    })
    .sort((a, b) => b.outstanding - a.outstanding);

  if (rows.length === 0) {
    return <p className="text-sm text-ink-muted">No open receivables to show exposure for.</p>;
  }

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
            dataKey="customerName"
            width={180}
            interval={0}
            tickLine={false}
            axisLine={false}
            tick={(props) => <CustomerTick {...props} />}
          />
          <Tooltip
            formatter={(_v: number, _n: string, item: any) => [
              `${inr(item.payload.outstanding)} · ${RISK_LABEL[item.payload.level as RiskLevel]} (${Math.round(
                item.payload.avgDelayProbability * 100,
              )}% avg. chance late)`,
              "Outstanding",
            ]}
            labelStyle={{ color: "var(--ink)", fontWeight: 600, marginBottom: 2 }}
            contentStyle={{
              fontSize: 12,
              border: "1px solid var(--line)",
              borderRadius: 10,
              boxShadow: "0 8px 24px -12px rgb(20 24 31 / 0.2)",
            }}
          />
          <Bar dataKey="outstanding" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.customerId} fill={RISK_COLOR[r.level]} />
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
      <div className="mt-3 flex gap-4 text-xs text-ink-muted">
        {(["low", "medium", "high"] as RiskLevel[]).map((l) => (
          <span key={l} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: RISK_COLOR[l] }} />
            {RISK_LABEL[l]}
          </span>
        ))}
      </div>
    </div>
  );
}
