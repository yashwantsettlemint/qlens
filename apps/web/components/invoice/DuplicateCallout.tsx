"use client";

import Link from "next/link";
import { useMutation } from "@apollo/client";
import { ReviewDuplicateMutation } from "@/graphql/operations/mutations";
import { Button } from "@/components/ui/Button";
import { ExplanationList } from "@/components/ui/ExplanationList";
import { inr, fmtDate, pct } from "@/lib/format";
import { reviewedStatusLabel } from "@/lib/status";
import type { InvoiceDetail } from "@/lib/types";

export function DuplicateCallout({
  invoiceId,
  flag,
}: {
  invoiceId: string;
  flag: NonNullable<InvoiceDetail["duplicateFlag"]>;
}) {
  const [review, { loading, error }] = useMutation(ReviewDuplicateMutation, {
    refetchQueries: ["InvoiceDetail"],
    onError: () => {}, // shown inline below, not thrown
  });
  const match = flag.matchedInvoice;
  const set = (status: string) => review({ variables: { invoiceId, status } });

  return (
    <section className="border-l-2 border-dup-fg bg-dup-bg/50 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-dup-fg">Possible duplicate</h2>
        <span className="text-xs text-dup-fg/80">
          {pct(flag.confidenceScore)} match confidence
        </span>
      </div>

      <p className="mt-2 text-sm text-ink">
        {match ? (
          <>
            Looks like{" "}
            <Link
              href={`/invoices/${match.id}`}
              className="tabular font-medium text-accent hover:underline"
            >
              {match.invoiceNumber}
            </Link>{" "}
            from {match.vendor?.name ?? "the same party"} — {inr(match.amount + match.taxAmount)}, dated{" "}
            {fmtDate(match.invoiceDate)}.
          </>
        ) : (
          <>Matched against invoice {flag.matchedInvoiceId}.</>
        )}
      </p>

      <p className="mt-1 text-xs text-ink-muted">
        Current status: {reviewedStatusLabel(flag.reviewedStatus)}
      </p>
      {flag.reason && <p className="mt-1 text-xs text-ink-muted">{flag.reason}</p>}

      <ExplanationList items={flag.explanation} />

      <div className="mt-3 flex gap-2">
        <Button
          variant="danger"
          disabled={loading || flag.reviewedStatus === "confirmed_duplicate"}
          onClick={() => set("confirmed_duplicate")}
        >
          Confirm duplicate
        </Button>
        <Button
          disabled={loading || flag.reviewedStatus === "false_positive"}
          onClick={() => set("false_positive")}
        >
          Not a duplicate
        </Button>
      </div>

      {error && <p className="mt-2 text-xs text-bad-fg">{error.message}</p>}
    </section>
  );
}
