"use client";

import { Loader2, MessageSquare, Mic, MicOff, Square } from "lucide-react";
import { useGeminiLiveDocumentContext } from "@/components/GeminiLiveDocumentProvider";

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
    inputMode,
    startSession,
    stopSession,
    toggleMic,
  } = useGeminiLiveDocumentContext();

  const aslActive = inputMode === "asl";

  if (status === "connecting") {
    return (
      <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--recast-border)] bg-[var(--recast-surface-elevated)]/90 px-4 py-3 text-sm font-medium text-[var(--recast-text-muted)]">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={2} />
        Connecting…
      </div>
    );
  }

  if (status === "live") {
    return (
      <div className="flex flex-col gap-2">
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
      <button
        type="button"
        onClick={() => void startSession(pdfUrl, fileName)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--recast-border)] bg-[var(--recast-surface-elevated)]/90 px-4 py-3 text-sm font-medium text-[var(--recast-text)] shadow-sm transition hover:border-[var(--recast-accent)] hover:text-[var(--recast-accent)]"
      >
        <MessageSquare className="h-4 w-4 shrink-0" strokeWidth={2} />
        Talk about this document
      </button>
      {status === "error" && error ? (
        <p className="text-xs leading-relaxed text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
