import Papa from "papaparse";
import { validateInvoiceInput, type InvoiceInputShape } from "./validateInvoice";

/** Serialise rows to RFC-4180 CSV. */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; label: string }[],
): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

/** Trigger a browser download of text as a file (client only). */
export function downloadCsv(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const CSV_TEMPLATE_HEADERS = [
  "invoiceNumber",
  "description",
  "vendor",
  "department",
  "invoiceDate",
  "dueDate",
  "amount",
  "taxAmount",
  "source",
] as const;

/** Columns a row can't be built without. `taxAmount`/`source` default. */
const REQUIRED_HEADERS = [
  "invoiceNumber",
  "vendor",
  "department",
  "invoiceDate",
  "dueDate",
  "amount",
] as const;

/** Thousands of papaparse errors -> a bounded summary grouped by message. */
function groupParseErrors(errors: Papa.ParseError[]): string[] {
  if (errors.length === 0) return [];
  const counts = new Map<string, number>();
  for (const e of errors) counts.set(e.message, (counts.get(e.message) ?? 0) + 1);
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const out: string[] = [];
  if (errors.length > 5) {
    out.push(`${errors.length} parse errors across ${ranked.length} kind(s):`);
  }
  for (const [msg, n] of ranked.slice(0, 6)) out.push(n > 1 ? `• ${msg} — ${n} rows` : `• ${msg}`);
  if (ranked.length > 6) out.push(`• …and ${ranked.length - 6} other kind(s)`);
  return out;
}

export interface ParsedInvoiceRow {
  line: number;
  raw: Record<string, string>;
  input: InvoiceInputShape | null;
  error: string | null;
}

/**
 * Parse an uploaded invoice CSV. Vendor is given by name in the file and
 * resolved to an id here; every row is validated so the preview can highlight
 * problems before anything is committed.
 */
export function parseInvoiceCsv(
  file: File,
  vendors: { id: string; name: string }[],
): Promise<{ rows: ParsedInvoiceRow[]; parseErrors: string[] }> {
  const byName = new Map(vendors.map((v) => [v.name.trim().toLowerCase(), v.id]));
  const knownIds = new Set(vendors.map((v) => v.id));

  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      delimitersToGuess: [",", ";", "\t", "|"],
      complete: (result) => {
        // Wrong-format file: bail with one clear message, not a row per line.
        const fields = (result.meta.fields ?? []).map((f) => f.trim());
        const missing = REQUIRED_HEADERS.filter((h) => !fields.includes(h));
        if (missing.length > 0) {
          resolve({
            rows: [],
            parseErrors: [
              `This file doesn't match the expected format — missing column${
                missing.length === 1 ? "" : "s"
              }: ${missing.join(", ")}.`,
              `Header row read as: ${
                fields.length ? fields.join(", ") : "none — is the first row the column names?"
              }`,
              `Expected: ${CSV_TEMPLATE_HEADERS.join(", ")}. Use “Download template” above.`,
            ],
          });
          return;
        }

        const rows: ParsedInvoiceRow[] = result.data.map((raw, i) => {
          const vendorName = (raw.vendor ?? "").trim();
          const vendorId = byName.get(vendorName.toLowerCase()) ?? "";
          const input: InvoiceInputShape = {
            invoiceNumber: (raw.invoiceNumber ?? "").trim(),
            description: (raw.description ?? "").trim() || null,
            vendorId,
            invoiceDate: (raw.invoiceDate ?? "").trim(),
            dueDate: (raw.dueDate ?? "").trim(),
            amount: Number((raw.amount ?? "").replace(/[,₹\s]/g, "")),
            taxAmount: Number((raw.taxAmount ?? "").replace(/[,₹\s]/g, "")),
            department: (raw.department ?? "").trim(),
            source: (raw.source ?? "csv").trim() || "csv",
          };
          let error = validateInvoiceInput(input, knownIds);
          if (!error && !vendorId) error = `Vendor "${vendorName}" not recognised`;
          return { line: i + 2, raw, input: error ? null : input, error };
        });
        resolve({ rows, parseErrors: groupParseErrors(result.errors) });
      },
    });
  });
}
