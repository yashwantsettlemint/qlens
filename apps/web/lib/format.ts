/** Formatting helpers. Money and dates render the same way everywhere. */

const inrFull = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const inrCompactFmt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** ₹1,23,456.00 — Indian digit grouping. */
export const inr = (n: number) => inrFull.format(n);

/** ₹1.2L / ₹4.3Cr — for axis ticks and tight stat lines. */
export const inrCompact = (n: number) => inrCompactFmt.format(n);

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const daysBetween = (a: string | Date, b: string | Date) =>
  Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);

/** Positive = past due by that many days; 0 or negative = not yet due. */
export const daysOverdue = (dueDate: string, today: Date = new Date()) =>
  daysBetween(today, dueDate);

export const pct = (fraction: number, digits = 0) =>
  `${(fraction * 100).toFixed(digits)}%`;

export const titleCase = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
