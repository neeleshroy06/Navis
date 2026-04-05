"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { AslFingerspellingPanel } from "@/components/AslFingerspellingPanel";
import { GeminiLiveDocumentProvider } from "@/components/GeminiLiveDocumentProvider";
import { CriticalActionsPanel } from "@/components/CriticalActionsPanel";
import { MedicationCalendarExport } from "@/components/MedicationCalendarExport";
import { TalkAboutDocumentControls } from "@/components/TalkAboutDocumentControls";
import { TranscriptPdfViewer } from "@/components/TranscriptPdfViewer";
import { usePdfDocument } from "@/components/PdfDocumentContext";

export default function DocumentPage() {
  const { pdfUrl, fileName } = usePdfDocument();
  const router = useRouter();

  useEffect(() => {
    if (!pdfUrl) {
      router.replace("/");
    }
  }, [pdfUrl, router]);

  if (!pdfUrl) {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        <AppHeader showReupload />
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--recast-text-muted)]">
          Returning to home…
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <AppHeader showReupload />

      <GeminiLiveDocumentProvider>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <div className="flex min-h-[45vh] min-w-0 flex-[3] flex-col border-b border-[var(--recast-border)]/40 p-3 sm:p-4 lg:border-b-0 lg:border-r lg:pb-4">
            <div className="min-h-0 flex-1 overflow-hidden">
              <TranscriptPdfViewer pdfUrl={pdfUrl} fileName={fileName} />
            </div>
          </div>

          <aside className="flex min-h-0 w-full flex-[1] flex-col gap-4 overflow-y-auto border-[var(--recast-border)]/40 p-3 sm:p-4 lg:max-w-none lg:border-l">
            <div className="flex shrink-0 flex-col gap-2">
              <TalkAboutDocumentControls pdfUrl={pdfUrl} fileName={fileName} />
              <AslFingerspellingPanel />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <MedicationCalendarExport />

              <CriticalActionsPanel />
            </div>
          </aside>
        </main>
      </GeminiLiveDocumentProvider>
    </div>
  );
}
