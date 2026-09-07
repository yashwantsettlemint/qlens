"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { AskPanel } from "@/components/ask/AskPanel";
import { useAsk } from "@/components/ask/AskContext";
import { IconAsk } from "@/components/ui/icons";

const CRUMB: Record<string, string> = {
  "/": "Dashboard",
  "/invoices": "Invoices",
  "/vendors": "Vendors",
  "/upload": "Upload",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { setOpen } = useAsk();
  const crumb =
    CRUMB[pathname] ??
    (pathname.startsWith("/invoices")
      ? "Invoices"
      : pathname.startsWith("/vendors")
        ? "Vendors"
        : "");

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-line bg-surface px-6">
          <span className="text-sm text-ink-muted">{crumb}</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-genai/40 bg-genai-tint px-3 text-sm font-medium text-genai hover:bg-genai/10"
          >
            <IconAsk width={15} height={15} />
            Ask
          </button>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-content px-8 py-7">{children}</div>
        </main>
      </div>
      <AskPanel />
    </div>
  );
}
