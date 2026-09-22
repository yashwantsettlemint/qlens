"use client";

import { cn } from "@/lib/cn";

export type Template = "classic" | "modern" | "minimal" | "sidebar" | "compact";

const TEMPLATES: { value: Template; label: string; accent: string; desc: string; kind: "bar" | "band" | "none" | "sidebar" | "compact" }[] = [
  { value: "classic", label: "Classic", accent: "#2A55D1", desc: "Thin accent line, soft totals card", kind: "bar" },
  { value: "modern", label: "Modern", accent: "#1D4ED8", desc: "Bold color header with logo chip", kind: "band" },
  { value: "minimal", label: "Minimal", accent: "#171923", desc: "Ultra-clean, generous whitespace", kind: "none" },
  { value: "sidebar", label: "Sidebar", accent: "#1E3A5F", desc: "Full-height sidebar with logo & bank details", kind: "sidebar" },
  { value: "compact", label: "Compact", accent: "#374151", desc: "Dense layout for many line items", kind: "compact" },
];

export function TemplatePicker({ value, onChange }: { value: Template; onChange: (t: Template) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {TEMPLATES.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cn(
            "rounded-lg border p-3 text-left transition-colors",
            value === t.value ? "border-accent ring-1 ring-accent" : "border-line hover:border-ink-muted",
          )}
        >
          <div className="mb-2 h-16 overflow-hidden rounded border border-line bg-white">
            {t.kind === "band" && (
              <div className="flex h-1/2 items-center gap-1 px-2" style={{ background: t.accent }}>
                <div className="h-3 w-3 rounded-sm bg-white" />
                <div className="h-1 w-8 rounded-sm bg-white/70" />
              </div>
            )}
            {t.kind === "bar" && (
              <>
                <div className="h-1" style={{ background: t.accent }} />
                <div className="mx-2 mt-2 h-1 w-1/2 rounded-sm bg-line" />
                <div className="mx-2 mt-1.5 h-4 w-10 self-end rounded-sm" style={{ background: `${t.accent}22`, marginLeft: "auto", marginRight: 8 }} />
              </>
            )}
            {t.kind === "none" && (
              <div className="p-2">
                <div className="h-1 w-1/3 rounded-sm bg-ink" />
                <div className="mt-2 h-0.5 w-full bg-line" />
              </div>
            )}
            {t.kind === "sidebar" && (
              <div className="flex h-full">
                <div className="h-full w-1/3" style={{ background: t.accent }} />
                <div className="flex-1 p-1.5">
                  <div className="h-1 w-3/4 rounded-sm bg-line" />
                  <div className="mt-1 h-3 w-10 rounded-sm" style={{ background: `${t.accent}22` }} />
                </div>
              </div>
            )}
            {t.kind === "compact" && (
              <div className="space-y-1 p-1.5">
                <div className="h-0.5 w-full" style={{ background: t.accent }} />
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-0.5 w-full rounded-sm bg-line" />
                ))}
              </div>
            )}
          </div>
          <div className="text-sm font-semibold text-ink">{t.label}</div>
          <div className="text-2xs text-ink-muted">{t.desc}</div>
        </button>
      ))}
    </div>
  );
}
