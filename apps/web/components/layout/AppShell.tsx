"use client";

import { TopNav } from "./TopNav";
import { AskPanel } from "@/components/ask/AskPanel";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopNav />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-8 sm:py-8">{children}</div>
      </main>
      <AskPanel />
    </div>
  );
}
