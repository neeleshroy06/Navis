"use client";

import { Calendar, ChevronDown, Download, FileText, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useGeminiLiveDocumentContext } from "@/components/GeminiLiveDocumentProvider";
import { buildMedicationCalendarIcs } from "@/lib/ics/buildMedicationCalendar";
import { buildMedicationListPdfBlob } from "@/lib/medications/buildMedicationListPdf";
import {
  canExtractMedicationSchedule,
  extractMedicationSchedule,
} from "@/lib/medications/extractMedicationSchedule";

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function MedicationCalendarExport() {
  const { documentExtractedText, heardText, replyText } = useGeminiLiveDocumentContext();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const hasContext =
    documentExtractedText.trim().length > 0 ||
    heardText.trim().length > 0 ||
    replyText.trim().length > 0;

  const disabled = busy || !hasContext || !canExtractMedicationSchedule();

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (el && !el.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const onDownloadPdf = async () => {
    setMenuOpen(false);
    if (!canExtractMedicationSchedule()) {
      setMessage(
        "Add NEXT_PUBLIC_GROQ_API_KEY and/or NEXT_PUBLIC_GOOGLE_API_KEY in .env.local (see .env.example). With default provider “auto”, Groq is used if set.",
      );
      return;
    }
    if (!hasContext) {
      setMessage("Start a conversation about your document first so we have text to extract from.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const payload = await extractMedicationSchedule({
        documentText: documentExtractedText,
        heardText,
        replyText,
      });
      if (payload.medications.length === 0) {
        setMessage(
          "No medications were found in the document or chat. Try discussing your prescriptions with the assistant, then export again.",
        );
        return;
      }
      const blob = buildMedicationListPdfBlob(payload.medications);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(`medications-list-${stamp}.pdf`, blob);
      setMessage(
        "Downloaded medication list (PDF). It includes current and new medications when the document distinguishes them.",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessage(`Could not generate PDF: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const onDownloadIcs = async () => {
    setMenuOpen(false);
    if (!canExtractMedicationSchedule()) {
      setMessage(
        "Add NEXT_PUBLIC_GROQ_API_KEY and/or NEXT_PUBLIC_GOOGLE_API_KEY in .env.local (see .env.example). With default provider “auto”, Groq is used if set.",
      );
      return;
    }
    if (!hasContext) {
      setMessage("Start a conversation about your document first so we have text to extract from.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const payload = await extractMedicationSchedule({
        documentText: documentExtractedText,
        heardText,
        replyText,
      });
      const meds = payload.medications.filter((m) => m.reminders.length > 0);
      if (meds.length === 0) {
        setMessage(
          "No medication schedule was found. Try asking Gemini about your prescriptions in chat, then export again.",
        );
        return;
      }
      const ics = buildMedicationCalendarIcs(meds);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(`medications-${stamp}.ics`, ics, "text/calendar;charset=utf-8");
      setMessage(
        "Downloaded reminder schedule. Import the file in Google Calendar or Apple Calendar.",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessage(`Could not generate calendar: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const controlsLocked = disabled || busy;

  const openMenu = () => {
    if (!controlsLocked) setMenuOpen((o) => !o);
  };

  const splitWrap =
    "flex w-full overflow-hidden rounded-xl border border-[var(--recast-border)]/80 bg-[var(--recast-surface)]/90 text-[var(--recast-text)]";

  return (
    <div ref={wrapRef} className="relative rounded-2xl border border-[var(--recast-border)]/60 bg-[var(--recast-surface-elevated)]/80 p-3 ring-1 ring-[var(--recast-border)]/25">
      <div className={splitWrap}>
        <button
          type="button"
          disabled={controlsLocked}
          onClick={openMenu}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--recast-surface-elevated)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={2} />
          ) : (
            <Download className="h-4 w-4 shrink-0" strokeWidth={2} />
          )}
          <span className="truncate">{busy ? "Generating…" : "Download"}</span>
        </button>
        <button
          type="button"
          disabled={controlsLocked}
          onClick={openMenu}
          aria-label="Open download options"
          className="inline-flex shrink-0 items-center justify-center border-l border-[var(--recast-border)]/70 px-3 py-2.5 transition hover:bg-[var(--recast-surface-elevated)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <ChevronDown
            className={`h-4 w-4 opacity-80 transition-transform ${menuOpen ? "rotate-180" : ""}`}
            strokeWidth={2}
          />
        </button>
      </div>

      {menuOpen && !busy ? (
        <div
          role="menu"
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-[var(--recast-border)]/80 bg-[var(--recast-surface-elevated)] shadow-lg ring-1 ring-black/5 dark:ring-white/10"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void onDownloadPdf()}
            className="flex w-full flex-col gap-0.5 border-b border-[var(--recast-border)]/50 px-3 py-2.5 text-left text-sm text-[var(--recast-text)] transition hover:bg-[var(--recast-surface)]/90"
          >
            <span className="inline-flex items-center gap-2 font-medium">
              <FileText className="h-4 w-4 shrink-0 text-[var(--recast-accent)]" strokeWidth={2} />
              Medication list
            </span>
            <span className="pl-6 text-xs text-[var(--recast-text-muted)]">PDF export</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void onDownloadIcs()}
            className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-sm text-[var(--recast-text)] transition hover:bg-[var(--recast-surface)]/90"
          >
            <span className="inline-flex items-center gap-2 font-medium">
              <Calendar className="h-4 w-4 shrink-0 text-[var(--recast-accent)]" strokeWidth={2} />
              Medication reminder
            </span>
            <span className="pl-6 text-xs leading-snug text-[var(--recast-text-muted)]">
              Add to Google Calendar or Apple Calendar by importing the downloaded file
            </span>
          </button>
        </div>
      ) : null}

      {message ? (
        <p className="mt-2 text-xs leading-relaxed text-[var(--recast-text-muted)]">{message}</p>
      ) : null}
    </div>
  );
}
