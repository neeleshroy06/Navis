"use client";

import { Loader2, MessageSquare, Mic, MicOff, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useGeminiLiveDocumentContext } from "@/components/GeminiLiveDocumentProvider";
import type { PhiRedactionSummary } from "@/lib/phiRedaction";

function redactionSummaryBlock(summary: PhiRedactionSummary[]): string {
  const sorted = [...summary].sort((a, b) => a.category.localeCompare(b.category));
  if (sorted.length === 0) {
    return [
      "SUMMARY BY CATEGORY",
      "----------------------------------------",
      "  (no category breakdown available)",
    ].join("\n");
  }
  const maxLen = Math.max(12, ...sorted.map((s) => s.category.length));
  const body = sorted.map(
    (s) => `  ${s.category.padEnd(maxLen)} ${s.count} instance(s)`,
  );
  return ["SUMMARY BY CATEGORY", "----------------------------------------", ...body].join("\n");
}

type Props = {
  pdfUrl: string;
  fileName: string | null;
};

export function TalkAboutDocumentControls({ pdfUrl, fileName }: Props) {
  const {
    status,
    error,
    micMuted,
    heardText,
    replyText,
    phiRedactionSummary,
    phiRedactionTotal,
    inputMode,
    startSession,
    stopSession,
    toggleMic,
  } = useGeminiLiveDocumentContext();

  const [redactionModalOpen, setRedactionModalOpen] = useState(false);

  const summaryText = useMemo(
    () => redactionSummaryBlock(phiRedactionSummary),
    [phiRedactionSummary],
  );

  const closeRedactionModal = useCallback(() => setRedactionModalOpen(false), []);

  useEffect(() => {
    if (!redactionModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRedactionModalOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [redactionModalOpen]);

  const aslActive = inputMode === "asl";

  const redactionModal =
    redactionModalOpen ? (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--recast-text)]/25 p-4 backdrop-blur-sm dark:bg-black/55"
        role="presentation"
        onClick={closeRedactionModal}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="phi-redaction-summary-title"
          className="max-h-[min(85vh,32rem)] w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--recast-border)] bg-[var(--recast-surface-elevated)] shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--recast-border)]/60 px-4 py-3">
            <h2 id="phi-redaction-summary-title" className="text-sm font-semibold text-[var(--recast-text)]">
              PHI redactions
            </h2>
            <button
              type="button"
              onClick={closeRedactionModal}
              className="rounded-lg p-1.5 text-[var(--recast-text-muted)] transition hover:bg-[var(--recast-surface)] hover:text-[var(--recast-text)]"
              aria-label="Close"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          <div className="max-h-[min(70vh,28rem)] overflow-auto p-4">
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--recast-text)] sm:text-xs">
              {summaryText}
            </pre>
          </div>
        </div>
      </div>
    ) : null;

  const phiBadge =
    phiRedactionTotal > 0 ? (
      <button
        type="button"
        onClick={() => setRedactionModalOpen(true)}
        className="w-full rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-center text-xs font-medium text-emerald-700 transition hover:border-emerald-500/45 hover:bg-emerald-500/15 dark:text-emerald-300 dark:hover:border-emerald-400/35 dark:hover:bg-emerald-500/15"
      >
        {`🔒 ${phiRedactionTotal} PHI ${phiRedactionTotal === 1 ? "instance" : "instances"} removed before sending to Gemini`}
      </button>
    ) : null;

  if (status === "connecting") {
    return (
      <div className="flex w-full flex-col gap-2">
        {redactionModal}
        <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--recast-border)] bg-[var(--recast-surface-elevated)]/90 px-4 py-3 text-sm font-medium text-[var(--recast-text-muted)]">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={2} />
          Connecting…
        </div>
        {phiBadge}
      </div>
    );
  }

  if (status === "live") {
    return (
      <div className="flex flex-col gap-2">
        {redactionModal}
        {phiBadge}
        <div className="flex w-full gap-2">
          <button
            type="button"
            disabled={aslActive}
            onClick={() => toggleMic()}
            title={
              aslActive
                ? "Microphone off while ASL mode is on"
                : micMuted
                  ? "Unmute microphone"
                  : "Mute microphone"
            }
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--recast-border)] bg-[var(--recast-surface-elevated)]/90 px-3 py-3 text-sm font-medium text-[var(--recast-text)] shadow-sm transition hover:border-[var(--recast-accent)] hover:text-[var(--recast-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {micMuted || aslActive ? (
              <MicOff className="h-4 w-4 shrink-0" strokeWidth={2} />
            ) : (
              <Mic className="h-4 w-4 shrink-0" strokeWidth={2} />
            )}
            {aslActive ? "Mic off (ASL)" : micMuted ? "Mic off" : "Mic on"}
          </button>
          <button
            type="button"
            onClick={() => stopSession()}
            title="End voice session"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-[var(--recast-surface-elevated)]/90 px-3 py-3 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-500/10 dark:text-red-400"
          >
            <Square className="h-4 w-4 shrink-0 fill-current" strokeWidth={2} />
            Stop
          </button>
        </div>
        <p className="text-center text-xs text-[var(--recast-accent)]">
          {aslActive ? "ASL spelling — camera active" : "Live — speak naturally"}
        </p>
        {heardText ? (
          <div className="rounded-xl border border-[var(--recast-border)]/60 bg-[var(--recast-surface-elevated)]/70 px-3 py-2 text-xs text-[var(--recast-text-muted)]">
            <span className="font-medium text-[var(--recast-text)]">You:</span> {heardText}
          </div>
        ) : null}
        {replyText ? (
          <div className="rounded-xl border border-[var(--recast-border)]/60 bg-[var(--recast-surface-elevated)]/70 px-3 py-2 text-xs text-[var(--recast-text-muted)]">
            <span className="font-medium text-[var(--recast-text)]">Gemini:</span> {replyText}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {redactionModal}
      <button
        type="button"
        onClick={() => void startSession(pdfUrl, fileName)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--recast-border)] bg-[var(--recast-surface-elevated)]/90 px-4 py-3 text-sm font-medium text-[var(--recast-text)] shadow-sm transition hover:border-[var(--recast-accent)] hover:text-[var(--recast-accent)]"
      >
        <MessageSquare className="h-4 w-4 shrink-0" strokeWidth={2} />
        Talk about this document
      </button>
      {phiBadge}
      {status === "error" && error ? (
        <p className="text-xs leading-relaxed text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
