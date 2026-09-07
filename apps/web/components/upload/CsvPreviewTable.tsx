"use client";

import { useMutation } from "@apollo/client";
import { ImportInvoicesMutation } from "@/graphql/operations/mutations";
import { Button } from "@/components/ui/Button";
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
        <ul className="border border-bad-fg/30 bg-bad-bg px-3 py-2 text-xs text-bad-fg">
          {parseErrors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {data?.importInvoices && (
        <p className="border border-ok-fg/30 bg-ok-bg px-3 py-2 text-sm text-ok-fg">
          Imported {data.importInvoices.created} invoice
          {data.importInvoices.created === 1 ? "" : "s"}.{" "}
          {data.importInvoices.failed > 0 && `${data.importInvoices.failed} skipped.`}
        </p>
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
            {rows.map((r) => (
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
    </div>
  );
}
