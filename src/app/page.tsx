"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  FileText,
  HeartPulse,
  Languages,
  MapPinned,
  MessageCircle,
  Puzzle,
  Shield,
  Sparkles,
  Upload,
} from "lucide-react";
import { FeaturesScrollSection } from "@/components/features/FeaturesScrollSection";
import type { FeatureItem } from "@/components/features/FeaturesScrollSection";
import { AppHeader } from "@/components/AppHeader";
import { PrivacyBrief } from "@/components/PrivacyBrief";
import { usePdfDocument } from "@/components/PdfDocumentContext";
import { hasPrivacyBriefAcknowledgment } from "@/lib/privacyBriefStorage";
import { isPdfFile } from "@/lib/pdf";

const FEATURES: FeatureItem[] = [
  {
    icon: Upload,
    title: "PDF & text upload",
    description:
      "Drop a PDF or paste discharge notes, med lists, or visit instructions. Your content stays in this session.",
  },
  {
    icon: Sparkles,
    title: "Interactive highlights",
    description:
      "Medications, conditions, warnings, and instructions surface as tappable highlights on the document.",
  },
  {
    icon: HeartPulse,
    title: "Critical actions",
    description:
      "A concise panel summarizes what to do, what to avoid, and when to seek help — refined with AI when available.",
  },
  {
    icon: MessageCircle,
    title: "Chat grounded in your file",
    description:
      "Ask questions in plain language; answers stay tied to the text you uploaded.",
  },
  {
    icon: MapPinned,
    title: "Find nearby pharmacies",
    description:
      "Enter a U.S. ZIP to open Google Maps with a search for pharmacies near that area.",
  },
  {
    icon: BookOpen,
    title: "Tap-to-explain",
    description:
      "Open any highlight for a short, plain-language explanation of that span.",
  },
  {
    icon: Languages,
    title: "Multiple languages",
    description:
      "Choose a language for explanations and critical-action summaries so they match how you read best.",
  },
  {
    icon: Shield,
    title: "Session-only, nothing stored",
    description:
      "We don’t keep your documents on our servers. Leave or close the tab and your text is gone — nothing persists after you exit.",
  },
  {
    icon: Puzzle,
    title: "Browser extension",
    description:
      "Coming soon: work with documents from the web without leaving your workflow.",
  },
];

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setPdfFromFile } = usePdfDocument();
  const router = useRouter();
  const [privacyBriefOpen, setPrivacyBriefOpen] = useState(false);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleUploadPdfClick = useCallback(() => {
    if (hasPrivacyBriefAcknowledgment()) {
      openFilePicker();
      return;
    }
    setPrivacyBriefOpen(true);
  }, [openFilePicker]);

  const handlePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !isPdfFile(file)) return;
    setPdfFromFile(file);
    router.push("/document");
  };

  return (
    <div className="relative z-10 min-h-full">
      <div className="flex min-h-[100dvh] flex-col">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          tabIndex={-1}
          onChange={handlePdfChange}
        />
        <AppHeader />

        <PrivacyBrief
          open={privacyBriefOpen}
          onOpenChange={setPrivacyBriefOpen}
          onContinue={openFilePicker}
        />

        <section className="relative flex flex-1 flex-col justify-center px-5 pb-16 pt-10 sm:px-10 sm:pb-20">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_55%_at_50%_20%,var(--recast-hero-glow),transparent)]"
          />
          <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center text-center">
            <h1 className="text-balance text-3xl font-semibold leading-[1.12] tracking-tight text-[var(--recast-text)] sm:text-4xl md:text-5xl lg:text-[3.25rem]">
              Understand your care. Act with confidence.
            </h1>
            <p className="mt-6 max-w-2xl text-balance text-base leading-relaxed text-[var(--recast-text-muted)] sm:mt-8 sm:text-lg md:text-xl">
              We help patients not just read their records — but actually know what to do.
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleUploadPdfClick}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[var(--recast-accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.22)_inset,0_2px_8px_rgba(11,191,11,0.25)] ring-1 ring-[var(--recast-accent-hover)]/35 transition hover:bg-[var(--recast-accent-hover)] dark:shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_2px_12px_rgba(0,0,0,0.35)]"
              >
                <FileText className="h-4 w-4 shrink-0" strokeWidth={2} />
                Upload PDF
              </button>
              <button
                type="button"
                disabled
                title="Coming soon"
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-[var(--recast-border)] bg-[var(--recast-surface-elevated)]/90 px-4 py-2.5 text-sm font-medium text-[var(--recast-text-muted)] opacity-80"
              >
                <Puzzle className="h-4 w-4" strokeWidth={2} />
                View demo
              </button>
            </div>
          </div>
        </section>
      </div>

      <FeaturesScrollSection features={FEATURES} />
    </div>
  );
}
