"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { paidBills, signedLateness } from "@/lib/vendorHistory";
import { fmtDate } from "@/lib/format";
import type { InvoiceRow } from "@/lib/types";

/** One bar per paid bill, oldest to newest: days paid after (+) or before
 * (-) the due date. Same on-time/1-7-late/8+-late color bands the rest of
 * the app already uses for risk (ok/warn/bad), applied here to actual
 * payment behaviour instead of a model's prediction. */
export function VendorPaymentTimelineChart({ invoices }: { invoices: InvoiceRow[] }) {
  const bills = paidBills(invoices).sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
  );
  if (bills.length === 0) {
    return <p className="text-sm text-ink-muted">No paid bills for this vendor yet.</p>;
  }

  const data = bills.map((b) => {
    const days = signedLateness(b);
    const color = days <= 0 ? "var(--ok-fg)" : days <= 7 ? "var(--warn-fg)" : "var(--bad-fg)";
    return { invoiceNumber: b.invoiceNumber, dueDate: b.dueDate, days, color };
  });

  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="dueDate"
            tickFormatter={(d: string) => fmtDate(d).replace(/ \d{4}$/, "")}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v: number) => (v > 0 ? `+${v}` : `${v}`)}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <ReferenceLine y={0} stroke="var(--line)" />
          <Tooltip
            cursor={{ fill: "var(--ink)", fillOpacity: 0.04 }}
            formatter={(v: number) => [v > 0 ? `${v}d late` : v < 0 ? `${-v}d early` : "on time", "vs due"]}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.invoiceNumber ?? ""}
            contentStyle={{ fontSize: 12, border: "1px solid var(--line)", borderRadius: 10 }}
          />
          <Bar dataKey="days" radius={[3, 3, 3, 3]} maxBarSize={26} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.invoiceNumber} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
