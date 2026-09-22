"use client";

import { useMutation } from "@apollo/client";
import { ImportInvoicesMutation } from "@/graphql/operations/mutations";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { cn } from "@/lib/cn";
import { inr } from "@/lib/format";
import type { ParsedInvoiceRow } from "@/lib/csv";

export function CsvPreviewTable({
  rows,
  parseErrors,
  onCommitted,
}: {
  rows: ParsedInvoiceRow[];
  parseErrors: string[];
  onCommitted: () => void;
}) {
  const valid = rows.filter((r) => !r.error && r.input);
  const validInputs = valid.map((r) => r.input!);
  const MAX_VISIBLE = 500;
  const visibleRows = rows.slice(0, MAX_VISIBLE);
  const [importInvoices, { data, loading }] = useMutation(ImportInvoicesMutation, {
    refetchQueries: ["Invoices", "DashboardStats"],
    awaitRefetchQueries: true,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-ok-fg">{valid.length} valid</span>
        <span className="text-bad-fg">{rows.length - valid.length} with errors</span>
        <Button
          variant="primary"
          disabled={loading || valid.length === 0}
          onClick={() =>
            importInvoices({ variables: { rows: validInputs } }).then(onCommitted)
          }
        >
          Commit {valid.length} valid row{valid.length === 1 ? "" : "s"}
        </Button>
      </div>

      {parseErrors.length > 0 && (
        <Callout tone="bad">
          <ul className="max-h-40 list-inside list-disc space-y-0.5 overflow-y-auto">
            {parseErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Callout>
      )}

      {data?.importInvoices && (
        <Callout tone="ok">
          Imported {data.importInvoices.created} invoice
          {data.importInvoices.created === 1 ? "" : "s"}.{" "}
          {data.importInvoices.failed > 0 && `${data.importInvoices.failed} skipped.`}
        </Callout>
      )}

      <div className="overflow-x-auto border border-line">
        <table className="w-full text-xs">
          <thead className="border-b border-line text-left text-ink-muted">
            <tr>
              <th className="px-2 py-1.5">Line</th>
              <th className="px-2 py-1.5">Invoice #</th>
              <th className="px-2 py-1.5">Vendor</th>
              <th className="px-2 py-1.5">Dept</th>
              <th className="px-2 py-1.5">Invoice date</th>
              <th className="px-2 py-1.5">Due date</th>
              <th className="px-2 py-1.5 text-right">Amount</th>
              <th className="px-2 py-1.5 text-right">Tax</th>
              <th className="px-2 py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr
                key={r.line}
                className={cn("border-b border-line last:border-0", r.error && "bg-bad-bg/40")}
              >
                <td className="tabular px-2 py-1.5">{r.line}</td>
                <td className="tabular px-2 py-1.5">{r.raw.invoiceNumber}</td>
                <td className="px-2 py-1.5">{r.raw.vendor}</td>
                <td className="px-2 py-1.5">{r.raw.department}</td>
                <td className="tabular px-2 py-1.5">{r.raw.invoiceDate}</td>
                <td className="tabular px-2 py-1.5">{r.raw.dueDate}</td>
                <td className="tabular px-2 py-1.5 text-right">
                  {Number(r.raw.amount) ? inr(Number(r.raw.amount)) : r.raw.amount}
                </td>
                <td className="tabular px-2 py-1.5 text-right">
                  {Number(r.raw.taxAmount) ? inr(Number(r.raw.taxAmount)) : r.raw.taxAmount}
                </td>
                <td className={cn("px-2 py-1.5", r.error ? "text-bad-fg" : "text-ok-fg")}>
                  {r.error ?? "Valid"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > MAX_VISIBLE && (
        <p className="text-xs text-ink-muted">
          Showing the first {MAX_VISIBLE} of {rows.length} rows. All {valid.length} valid rows
          still commit.
        </p>
      )}
    </div>
  );
}
