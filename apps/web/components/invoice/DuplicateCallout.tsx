"use client";

import Link from "next/link";
import { useMutation } from "@apollo/client";
import { ReviewDuplicateMutation } from "@/graphql/operations/mutations";
import { Button } from "@/components/ui/Button";
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
  const [review, { loading }] = useMutation(ReviewDuplicateMutation, {
    refetchQueries: ["InvoiceDetail"],
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
            from {match.vendor.name} — {inr(match.amount + match.taxAmount)}, dated{" "}
            {fmtDate(match.invoiceDate)}.
          </>
        ) : (
          <>Matched against invoice {flag.matchedInvoiceId}.</>
        )}
      </p>

      <p className="mt-1 text-xs text-ink-muted">
        Current status: {reviewedStatusLabel(flag.reviewedStatus)}
      </p>

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
    </section>
  );
}
