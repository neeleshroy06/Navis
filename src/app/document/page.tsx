"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { AslFingerspellingPanel } from "@/components/AslFingerspellingPanel";
import { GeminiLiveDocumentProvider } from "@/components/GeminiLiveDocumentProvider";
import { TalkAboutDocumentControls } from "@/components/TalkAboutDocumentControls";
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
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader showReupload />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="flex min-h-[45vh] min-w-0 flex-[3] flex-col border-b border-[var(--recast-border)]/40 p-3 sm:p-4 lg:border-b-0 lg:border-r lg:pb-4">
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--recast-border)]/50 bg-[var(--recast-surface-elevated)]/50 shadow-inner ring-1 ring-[var(--recast-border)]/30">
            <iframe
              title={fileName ? `PDF: ${fileName}` : "Uploaded PDF"}
              src={`${pdfUrl}#view=FitH`}
              className="h-full min-h-[40vh] w-full bg-[var(--recast-surface)] lg:min-h-0"
            />
          </div>
        </div>

        <aside className="flex min-h-0 w-full flex-[1] flex-col gap-4 overflow-y-auto border-[var(--recast-border)]/40 p-3 sm:p-4 lg:max-w-none lg:border-l">
          <GeminiLiveDocumentProvider>
            <div className="flex shrink-0 flex-col gap-2">
              <TalkAboutDocumentControls pdfUrl={pdfUrl} fileName={fileName} />
              <AslFingerspellingPanel />
            </div>
          </GeminiLiveDocumentProvider>

          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <section className="rounded-2xl border border-[var(--recast-border)]/60 bg-[var(--recast-surface-elevated)]/80 p-4 ring-1 ring-[var(--recast-border)]/25">
              <h2 className="text-sm font-semibold tracking-tight text-[var(--recast-text)]">
                Critical actions
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--recast-text-muted)]">
                Key measures and steps to take will appear here once analysis is
                connected.
              </p>
            </section>

            <section className="rounded-2xl border border-[var(--recast-border)]/60 bg-[var(--recast-surface-elevated)]/80 p-4 ring-1 ring-[var(--recast-border)]/25">
              <h2 className="text-sm font-semibold tracking-tight text-[var(--recast-text)]">
                Focus region
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--recast-text-muted)]">
                When you select text in the document, focused details will show
                here.
              </p>
            </section>
          </div>
        </aside>
      </main>
    </div>
  );
}
