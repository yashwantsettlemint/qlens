"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@apollo/client";
import { DemoRequestsQuery } from "@/graphql/operations/queries";
import { DeleteDemoRequestMutation } from "@/graphql/operations/mutations";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { QueryState } from "@/components/ui/QueryState";
import { Callout } from "@/components/ui/Callout";
import { fmtDateTime } from "@/lib/format";

export default function DemoRequestsPage() {
  const { data, loading, error, refetch } = useQuery(DemoRequestsQuery, { variables: { limit: 200 } });
  const [deleteDemoRequest] = useMutation(DeleteDemoRequestMutation);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function remove(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteDemoRequest({ variables: { id } });
      await refetch();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn't delete that request");
    } finally {
      setDeletingId(null);
    }
  }

  const rows = data?.demoRequests ?? [];

  return (
    <>
      <PageHeader title="Demo requests" meta="Submitted from the public landing page's &quot;Book a demo&quot; form." />

      {deleteError && (
        <Callout tone="bad" className="mb-4 text-xs">
          {deleteError}
        </Callout>
      )}

      <Panel>
        <QueryState loading={loading} error={error} minRows={3}>
          {rows.length === 0 ? (
            <p className="py-2 text-sm text-ink-muted">No demo requests yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((d) => (
                <li key={d.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">
                      {d.companyName} <span className="font-normal text-ink-muted">· {d.contactName}</span>
                    </div>
                    <div className="text-xs text-ink-muted">
                      <a href={`mailto:${d.workEmail}`} className="hover:underline">
                        {d.workEmail}
                      </a>
                      {d.companySize ? ` · ${d.companySize} employees` : ""}
                    </div>
                    {d.message && <div className="mt-1.5 max-w-[70ch] text-sm text-ink">{d.message}</div>}
                  </div>
                  <div className="flex flex-none flex-col items-end gap-2">
                    <span className="tabular text-xs text-ink-muted">{fmtDateTime(d.createdAt)}</span>
                    <button
                      type="button"
                      onClick={() => remove(d.id)}
                      disabled={deletingId === d.id}
                      className="text-xs font-semibold text-bad-fg hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingId === d.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Panel>
    </>
  );
}
