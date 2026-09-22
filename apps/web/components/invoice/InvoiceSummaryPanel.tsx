"use client";

import { useQuery } from "@apollo/client";
import { InvoiceSummaryQuery } from "@/graphql/operations/queries";
import { Panel } from "@/components/ui/Panel";

/** "What is this invoice for" — the manually-entered description if there is
 * one, otherwise an LLM-generated summary from the invoice's own fields
 * (vendor/customer, department, amount, line items). The query only runs
 * when there's no description, so most invoices never pay for an LLM call. */
export function InvoiceSummaryPanel({
  invoiceId,
  description,
}: {
  invoiceId: string;
  description?: string | null;
}) {
  const { data, loading, error } = useQuery(InvoiceSummaryQuery, {
    variables: { id: invoiceId },
    skip: !!description,
  });

  if (description) {
    return (
      <Panel title="Summary">
        <p className="text-sm text-ink">{description}</p>
      </Panel>
    );
  }

  if (loading) {
    return (
      <Panel title="Summary">
        <p className="text-sm text-ink-muted">Generating summary…</p>
      </Panel>
    );
  }
  if (error || !data?.invoiceSummary) return null;

  return (
    <Panel title="Summary">
      <p className="text-sm text-ink">{data.invoiceSummary}</p>
    </Panel>
  );
}
