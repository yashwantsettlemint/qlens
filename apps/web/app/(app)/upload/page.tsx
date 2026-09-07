"use client";

import { useState } from "react";
import { useQuery } from "@apollo/client";
import { VendorsQuery } from "@/graphql/operations/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import { ManualInvoiceForm } from "@/components/upload/ManualInvoiceForm";
import { CsvDropzone } from "@/components/upload/CsvDropzone";
import { CsvPreviewTable } from "@/components/upload/CsvPreviewTable";
import type { ParsedInvoiceRow } from "@/lib/csv";

type Tab = "manual" | "csv";

export default function UploadPage() {
  const [tab, setTab] = useState<Tab>("manual");
  const { data } = useQuery(VendorsQuery);
  const vendors = (data?.vendors ?? []).map((v) => v.vendor);

  const [parsed, setParsed] = useState<{
    rows: ParsedInvoiceRow[];
    parseErrors: string[];
    name: string;
  } | null>(null);

  return (
    <>
      <PageHeader title="Add invoices" meta="Enter one by hand, or import a CSV" />

      <div className="mb-4 flex gap-1 border-b border-line">
        {(["manual", "csv"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              tab === t
                ? "border-accent font-medium text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t === "manual" ? "Manual entry" : "CSV upload"}
          </button>
        ))}
      </div>

      {tab === "manual" ? (
        <Panel>
          <ManualInvoiceForm vendors={vendors} />
        </Panel>
      ) : (
        <div className="space-y-4">
          <CsvDropzone
            vendors={vendors}
            fileName={parsed?.name ?? null}
            onParsed={(rows, parseErrors, name) => setParsed({ rows, parseErrors, name })}
          />
          {parsed && (
            <CsvPreviewTable
              rows={parsed.rows}
              parseErrors={parsed.parseErrors}
              onCommitted={() => setParsed(null)}
            />
          )}
        </div>
      )}
    </>
  );
}
