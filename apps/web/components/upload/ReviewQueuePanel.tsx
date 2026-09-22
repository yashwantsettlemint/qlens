"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@apollo/client";
import { ReviewQueueQuery, VendorsQuery, CustomersQuery } from "@/graphql/operations/queries";
import { SetReviewQueueStatusMutation } from "@/graphql/operations/mutations";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { QueryState } from "@/components/ui/QueryState";
import { fmtDate } from "@/lib/format";
import { DocumentReviewForm, type OcrResult } from "@/components/upload/DocumentReviewForm";

type ReviewItem = {
  id: string;
  status: string;
  issues: string[];
  createdAt: string;
  filename: string | null;
  direction: string | null;
  counterpartyName: string | null;
  extractedFieldsJson: string;
  sourceMapJson: string;
  fullText: string | null;
};

function toOcrResult(item: ReviewItem): OcrResult {
  let extracted_fields: Record<string, any> = {};
  let source_map: OcrResult["source_map"] = [];
  try {
    extracted_fields = JSON.parse(item.extractedFieldsJson || "{}");
  } catch {
    /* malformed draft — form just shows blank fields */
  }
  try {
    source_map = JSON.parse(item.sourceMapJson || "[]");
  } catch {
    /* ignore */
  }
  return {
    extracted_fields,
    source_map,
    full_text: item.fullText ?? undefined,
    possible_duplicate: null,
    direction: item.direction === "receivable" ? "receivable" : "payable",
    counterparty_name: item.counterpartyName,
    direction_detected: Boolean(item.direction),
    valid: false, // always route through the review form here, whatever the original confidence was
    issues: item.issues,
    review_queue_id: item.id,
  };
}

/** Drafts queued by document upload that couldn't be auto-committed — review
 * the extracted fields, commit to an invoice, or reject the draft. Sits below
 * the upload dropzone on the Upload page; nothing to render when empty. */
export function ReviewQueuePanel() {
  const { data, loading, error, refetch } = useQuery(ReviewQueueQuery, {
    variables: { status: "pending" },
    pollInterval: 5000, // picks up drafts a background bulk-upload job just finished
  });
  const { data: vendorData } = useQuery(VendorsQuery);
  const vendors = (vendorData?.vendors ?? []).map((v) => v.vendor);
  const { data: custData } = useQuery(CustomersQuery);
  const customers = (custData?.customers ?? []).map((c) => c.customer);

  const [setStatus] = useMutation(SetReviewQueueStatusMutation, { onError: () => {} });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = (data?.reviewQueue ?? []) as ReviewItem[];
  const selected = items.find((i) => i.id === selectedId) ?? null;

  async function reject(id: string) {
    await setStatus({ variables: { id, status: "rejected" } });
    if (selectedId === id) setSelectedId(null);
    refetch();
  }

  async function afterCommit(id: string) {
    await setStatus({ variables: { id, status: "committed" } });
    setSelectedId(null);
    refetch();
  }

  if (loading && !data) return null;
  if (error) return <Callout tone="bad">Couldn&rsquo;t load the review queue: {error.message}</Callout>;
  if (items.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-ink-muted">
        Review queue ({items.length})
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <Panel className="lg:sticky lg:top-4 lg:self-start">
          <ul className="divide-y divide-line -m-5">
            {items.map((item) => (
              <li
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`cursor-pointer px-5 py-3 text-sm hover:bg-ground ${
                  selectedId === item.id ? "bg-ground" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{item.filename ?? item.counterpartyName ?? "Untitled"}</span>
                  <Badge tone="warn">{item.issues.length} issue{item.issues.length === 1 ? "" : "s"}</Badge>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-2xs text-ink-muted">
                  <span className="tabular">{fmtDate(item.createdAt)}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      reject(item.id);
                    }}
                    className="text-bad-fg hover:underline"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <div>
          {!selected ? (
            <Panel>
              <p className="text-sm text-ink-muted">Select a draft on the left to review it.</p>
            </Panel>
          ) : (
            <>
              {selected.issues.length > 0 && (
                <Callout tone="warn" className="mb-3">
                  {selected.issues.join(" · ")}
                </Callout>
              )}
              <DocumentReviewForm
                key={selected.id}
                result={toOcrResult(selected)}
                filename={selected.filename}
                vendors={vendors}
                customers={customers}
                onCommitted={() => afterCommit(selected.id)}
              />
              <div className="mt-3">
                <Button variant="danger" onClick={() => reject(selected.id)}>
                  Reject this draft
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
