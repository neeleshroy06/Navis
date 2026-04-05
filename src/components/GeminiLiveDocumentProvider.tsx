"use client";

import { createContext, useContext } from "react";
import { useGeminiLiveDocument } from "@/hooks/useGeminiLiveDocument";

export type GeminiLiveDocumentContextValue = ReturnType<typeof useGeminiLiveDocument>;

const GeminiLiveDocumentContext = createContext<GeminiLiveDocumentContextValue | null>(null);

export function GeminiLiveDocumentProvider({ children }: { children: React.ReactNode }) {
  const live = useGeminiLiveDocument();
  return (
    <GeminiLiveDocumentContext.Provider value={live}>{children}</GeminiLiveDocumentContext.Provider>
  );
}

export function useGeminiLiveDocumentContext(): GeminiLiveDocumentContextValue {
  const ctx = useContext(GeminiLiveDocumentContext);
  if (!ctx) {
    throw new Error("useGeminiLiveDocumentContext must be used within GeminiLiveDocumentProvider");
  }
  return ctx;
}
