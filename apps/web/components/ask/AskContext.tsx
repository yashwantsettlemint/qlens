"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface AskContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  seed: string;
  askAbout: (prompt: string) => void;
}

const AskContext = createContext<AskContextValue | null>(null);

export function AskProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState("");
  return (
    <AskContext.Provider
      value={{
        open,
        setOpen,
        seed,
        askAbout: (prompt) => {
          setSeed(prompt);
          setOpen(true);
        },
      }}
    >
      {children}
    </AskContext.Provider>
  );
}

export function useAsk() {
  const ctx = useContext(AskContext);
  if (!ctx) throw new Error("useAsk must be used inside <AskProvider>");
  return ctx;
}
