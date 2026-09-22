"use client";

import { useRef, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Badge } from "@/components/ui/Badge";
import { IconUpload } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

type JobStatus = "queued" | "processing" | "done" | "failed";

interface Job {
  job_id: string;
  filename: string;
  status: JobStatus;
  result?: {
    valid: boolean;
    issues: string[];
    review_queue_id: string | null;
  } | null;
}

const STATUS_TONE: Record<JobStatus, "neutral" | "warn" | "ok" | "bad"> = {
  queued: "neutral",
  processing: "warn",
  done: "ok",
  failed: "bad",
};

const POLL_MS = 2000;

/** Multiple PDFs/images at once, queued over RabbitMQ and processed in the
 * background by ocr-service — each lands in the Review Queue (extracted +
 * validated, whether or not it's clean) since nobody's watching this tab to
 * click "create" the way the single-document flow works. */
export function BulkDocumentUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pickFiles() {
    inputRef.current?.click();
  }

  async function onFilesChosen(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErr(null);
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      const resp = await fetch("/api/bulk-upload", { method: "POST", body: fd });
      const body = await resp.json();
      if (!resp.ok) {
        setErr(body?.error ?? `Upload failed (${resp.status}).`);
        return;
      }
      const newJobs: Job[] = body.jobs;
      setJobs((prev) => [...newJobs, ...prev]);
      poll(newJobs.map((j) => j.job_id));
    } catch {
      setErr("Could not reach the server.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function poll(ids: string[]) {
    const tick = async () => {
      let body: { jobs?: Job[] } | null = null;
      try {
        const resp = await fetch(`/api/bulk-upload?ids=${ids.join(",")}`);
        body = await resp.json();
      } catch {
        return; // transient — next tick tries again
      }
      const fresh = body?.jobs ?? [];
      setJobs((prev) => prev.map((j) => fresh.find((f) => f.job_id === j.job_id) ?? j));
      const pending = ids.filter((id) => {
        const j = fresh.find((f) => f.job_id === id);
        return !j || j.status === "queued" || j.status === "processing";
      });
      if (pending.length > 0) setTimeout(() => poll(pending), POLL_MS);
    };
    setTimeout(tick, POLL_MS);
  }

  return (
    <div className="space-y-4">
      <Panel>
        <div
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line px-6 py-10 text-center hover:border-accent"
          onClick={pickFiles}
        >
          <IconUpload className="h-6 w-6 text-ink-muted" />
          <div className="text-sm text-ink">Click to choose multiple PDFs / images</div>
          <div className="text-2xs text-ink-muted">
            Each is queued and processed in the background, then lands in the Review Queue.
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,application/pdf,image/*"
            className="hidden"
            onChange={(e) => onFilesChosen(e.target.files)}
          />
          <Button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); pickFiles(); }}>
            {busy ? "Queuing…" : "Choose files"}
          </Button>
        </div>
        {err && <Callout tone="bad" className="mt-3 text-xs">{err}</Callout>}
      </Panel>

      {jobs.length > 0 && (
        <Panel title={`Batch (${jobs.length})`}>
          <ul className="divide-y divide-line">
            {jobs.map((j) => (
              <li key={j.job_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate">{j.filename}</span>
                <div className="flex shrink-0 items-center gap-2">
                  {j.result && !j.result.valid && j.result.issues?.length > 0 && (
                    <span className="text-2xs text-ink-muted">{j.result.issues[0]}</span>
                  )}
                  {j.result?.review_queue_id && (
                    <span className="tabular text-2xs text-ink-muted">
                      queue #{j.result.review_queue_id.slice(0, 8)}
                    </span>
                  )}
                  <Badge tone={STATUS_TONE[j.status]}>{j.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
