/** Indian GST: same state -> CGST+SGST (half the rate each), different
 * state -> IGST (full rate) — states are compared case-insensitively since
 * they're free-text fields, not a fixed enum. */

export interface GstLineItem {
  hsnSac: string | null;
  gstRate: number | null;
  taxableValue: number;
}

export interface GstGroup {
  hsnSac: string;
  gstRate: number;
  taxableValue: number;
  /** Present when company/customer are in different states. */
  igst?: number;
  /** Present when they're in the same state — each is half of gstRate. */
  cgst?: number;
  sgst?: number;
  taxAmount: number;
}

export interface GstSplit {
  sameState: boolean;
  groups: GstGroup[];
  totalTaxable: number;
  totalTax: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function splitTax(
  lineItems: GstLineItem[],
  companyState: string | null | undefined,
  customerState: string | null | undefined,
): GstSplit {
  const sameState = Boolean(
    companyState && customerState && companyState.trim().toLowerCase() === customerState.trim().toLowerCase(),
  );

  const byKey = new Map<string, { hsnSac: string; gstRate: number; taxableValue: number }>();
  for (const li of lineItems) {
    const hsnSac = li.hsnSac?.trim() || "-";
    const gstRate = li.gstRate ?? 0;
    const key = `${hsnSac}|${gstRate}`;
    const existing = byKey.get(key);
    if (existing) existing.taxableValue += li.taxableValue;
    else byKey.set(key, { hsnSac, gstRate, taxableValue: li.taxableValue });
  }

  const groups: GstGroup[] = Array.from(byKey.values()).map((g) => {
    const taxAmount = round2(g.taxableValue * (g.gstRate / 100));
    if (sameState) {
      const half = round2(taxAmount / 2);
      return { ...g, taxableValue: round2(g.taxableValue), cgst: half, sgst: half, taxAmount: half * 2 };
    }
    return { ...g, taxableValue: round2(g.taxableValue), igst: taxAmount, taxAmount };
  });

  return {
    sameState,
    groups,
    totalTaxable: round2(groups.reduce((s, g) => s + g.taxableValue, 0)),
    totalTax: round2(groups.reduce((s, g) => s + g.taxAmount, 0)),
  };
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? " " + ONES[o] : "");
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return (h ? ONES[h] + " Hundred" + (rest ? " " : "") : "") + (rest ? twoDigits(rest) : "");
}

/** Indian numbering (Lakh/Crore), whole rupees only — e.g. 2764740 ->
 * "Twenty Seven Lakh Sixty Four Thousand Seven Hundred Forty Only". */
export function amountInWords(amount: number): string {
  const n = Math.round(Math.abs(amount));
  if (n === 0) return "Zero Only";

  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor((n % 1e7) / 1e5);
  const thousand = Math.floor((n % 1e5) / 1e3);
  const hundred = n % 1e3;

  const parts: string[] = [];
  if (crore) parts.push(threeDigits(crore) + " Crore");
  if (lakh) parts.push(threeDigits(lakh) + " Lakh");
  if (thousand) parts.push(threeDigits(thousand) + " Thousand");
  if (hundred) parts.push(threeDigits(hundred));

  return parts.join(" ") + " Only";
}
