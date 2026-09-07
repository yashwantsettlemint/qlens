"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { CSV_TEMPLATE_HEADERS, parseInvoiceCsv, type ParsedInvoiceRow } from "@/lib/csv";
import { IconUpload } from "@/components/ui/icons";

interface VendorOption {
  id: string;
  name: string;
}

const TEMPLATE = `${CSV_TEMPLATE_HEADERS.join(",")}
ACME/26-27/2001,Havells India Ltd,IT,2026-08-01,2026-08-31,125000,22500,csv`;

export function CsvDropzone({
  vendors,
  onParsed,
  fileName,
}: {
  vendors: VendorOption[];
  onParsed: (rows: ParsedInvoiceRow[], parseErrors: string[], name: string) => void;
  fileName: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handle(file: File) {
    const { rows, parseErrors } = await parseInvoiceCsv(file, vendors);
    onParsed(rows, parseErrors, file.name);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handle(file);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 border border-dashed px-6 py-10 text-center text-sm",
          dragging ? "border-accent bg-accent/5" : "border-line bg-surface",
        )}
      >
        <IconUpload width={22} height={22} className="text-ink-muted" />
        <div>
          Drop a CSV here, or{" "}
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => inputRef.current?.click()}
          >
            choose a file
          </button>
        </div>
        {fileName && <div className="tabular text-xs text-ink-muted">Loaded: {fileName}</div>}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handle(file);
          }}
        />
      </div>
      <div className="mt-2 flex gap-4 text-xs text-ink-muted">
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
          download="invoice-template.csv"
          className="text-accent hover:underline"
        >
          Download template
        </a>
        <a href="/sample-invoices.csv" download className="text-accent hover:underline">
          Try a sample file
        </a>
        <span>Columns: {CSV_TEMPLATE_HEADERS.join(", ")}</span>
      </div>
    </div>
  );
}
