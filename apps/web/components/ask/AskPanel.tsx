"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLazyQuery } from "@apollo/client";
import { AskQuery } from "@/graphql/operations/queries";
import { useAsk } from "./AskContext";
import { cn } from "@/lib/cn";
import { inr } from "@/lib/format";
import { IconAsk, IconClose } from "@/components/ui/icons";
import { ApprovalBadge, PaymentBadge, DuplicateBadge } from "@/components/ui/Badge";
import { RiskDot } from "@/components/ui/RiskDot";
import type { InvoiceRow } from "@/lib/types";

interface Turn {
  role: "user" | "assistant";
  text: string;
  invoices?: InvoiceRow[];
}

const EXAMPLES = [
  "Summarise all high-risk invoices this month",
  "Which payments are overdue?",
  "Show every invoice flagged as a duplicate",
];

export function AskPanel() {
  const { open, setOpen, seed } = useAsk();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [runAsk, { loading }] = useLazyQuery(AskQuery, { fetchPolicy: "no-cache" });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && seed) setInput(seed);
  }, [open, seed]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, loading]);

  async function send(prompt: string) {
    const q = prompt.trim();
    if (!q || loading) return;
    setTurns((t) => [...t, { role: "user", text: q }]);
    setInput("");
    try {
      const { data, error } = await runAsk({ variables: { prompt: q } });
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          text: data?.ask.text ?? (error ? `Couldn’t answer that: ${error.message}` : "No answer."),
          invoices: (data?.ask.invoices ?? []) as InvoiceRow[],
        },
      ]);
    } catch (e: any) {
      setTurns((t) => [
        ...t,
        { role: "assistant", text: `Couldn’t reach the assistant: ${e?.message ?? e}` },
      ]);
    }
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-ink/20"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[440px] flex-col border-l border-genai/30 bg-surface shadow-xl"
        role="dialog"
        aria-label="Ask about your invoices"
      >
        <header className="flex items-center justify-between border-b border-line bg-genai-tint px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-genai">
            <IconAsk width={16} height={16} />
            Ask about your invoices
          </div>
          <div className="flex items-center gap-3">
            {turns.length > 0 && (
              <button
                onClick={() => {
                  setTurns([]);
                  setInput("");
                }}
                className="text-xs text-genai/70 hover:text-genai"
              >
                Clear chat
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-genai/70 hover:text-genai"
            >
              <IconClose width={16} height={16} />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {turns.length === 0 && (
            <div className="space-y-3 text-sm text-ink-muted">
              <p>
                Plain-language questions about approvals, overdue balances, duplicate flags
                and delay risk. Answers are generated from the current data.
              </p>
              <div className="space-y-1.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => send(ex)}
                    className="block w-full rounded border border-genai/25 bg-genai-tint/50 px-3 py-1.5 text-left text-sm text-genai hover:bg-genai-tint"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, i) => (
            <div
              key={i}
              className={cn(
                "text-sm",
                turn.role === "user" ? "flex justify-end" : "space-y-2",
              )}
            >
              {turn.role === "user" ? (
                <div className="max-w-[85%] rounded bg-ground px-3 py-2 text-ink">
                  {turn.text}
                </div>
              ) : (
                <>
                  <div className="border-l-2 border-genai/40 pl-3 leading-relaxed text-ink">
                    {turn.text}
                  </div>
                  {turn.invoices && turn.invoices.length > 0 && (
                    <AskInvoiceList rows={turn.invoices} onNavigate={() => setOpen(false)} />
                  )}
                </>
              )}
            </div>
          ))}

          {loading && <div className="text-sm text-ink-muted">Thinking…</div>}
        </div>

        <form
          className="border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={2}
            placeholder="Ask a question…"
            className="w-full resize-none rounded border border-line bg-surface p-2 text-sm outline-none focus:border-genai"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="inline-flex h-8 items-center rounded border border-genai bg-genai px-3 text-sm font-medium text-white disabled:opacity-40"
            >
              Ask
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

function AskInvoiceList({
  rows,
  onNavigate,
}: {
  rows: InvoiceRow[];
  onNavigate: () => void;
}) {
  return (
    <div className="overflow-hidden rounded border border-line">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((inv) => (
            <tr key={inv.id} className="border-b border-line last:border-0">
              <td className="px-2 py-1.5">
                <Link
                  href={`/invoices/${inv.id}`}
                  onClick={onNavigate}
                  className="tabular text-accent hover:underline"
                >
                  {inv.invoiceNumber}
                </Link>
                <div className="text-ink-muted">{inv.vendor?.name ?? inv.customer?.name}</div>
              </td>
              <td className="tabular px-2 py-1.5 text-right">{inr(inv.amount + inv.taxAmount)}</td>
              <td className="px-2 py-1.5">
                <div className="flex items-center justify-end gap-1">
                  <RiskDot pred={inv.delayPrediction} />
                  {inv.duplicateFlag && <DuplicateBadge />}
                  <ApprovalBadge status={inv.approvalStatus} />
                  <PaymentBadge status={inv.paymentStatus} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
