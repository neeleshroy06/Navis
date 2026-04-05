"use client";

import { DM_Serif_Display } from "next/font/google";
import Image from "next/image";
import { Check, X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { setPrivacyBriefAcknowledgment } from "@/lib/privacyBriefStorage";

const displayFont = DM_Serif_Display({
  weight: "400",
  subsets: ["latin"],
});

type Point = {
  lead: string;
  body: string;
};

const POINTS: Point[] = [
  {
    lead: "Your file never leaves your browser",
    body: "The PDF is read locally by your device. We do not upload your file to any server.",
  },
  {
    lead: "We strip your identity before anything is analyzed",
    body:
      "Before your document's content is sent for AI analysis, Navis automatically removes names, dates of birth, MRN numbers, addresses, phone numbers, and other identifying information. The AI only ever sees the clinical content — your diagnoses, medications, lab results.",
  },
  {
    lead: "Your voice stays in the session",
    body: "If you use voice or ASL input, that data is processed in real time and discarded. We don't record or store conversations.",
  },
  {
    lead: "We don't have a backend",
    body: "There is no Navis database holding your information. When you close this tab, the session is gone.",
  },
  {
    lead: "What does leave your device",
    body:
      "Anonymized clinical text (with all personal identifiers removed) is sent to Google's Gemini API for analysis. Google processes this under their standard API terms. This is not a HIPAA-certified setup — Navis is a research prototype, not a clinical tool.",
  },
  {
    lead: "Be mindful with sensitive records",
    body: "While Navis removes identifying information before analysis, you can choose to start with a non-sensitive document if you'd like to explore how it works.",
  },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after acknowledgment is stored; use to open the file picker */
  onContinue: () => void;
};

/** Pixels from bottom to count as “reached the end” (subpixel / font rounding). */
const SCROLL_END_THRESHOLD_PX = 16;

function isScrollAtBottom(el: HTMLElement): boolean {
  const { scrollTop, scrollHeight, clientHeight } = el;
  if (scrollHeight <= clientHeight + 1) return true;
  return scrollTop + clientHeight >= scrollHeight - SCROLL_END_THRESHOLD_PX;
}

export function PrivacyBrief({ open, onOpenChange, onContinue }: Props) {
  const titleId = useId();
  const continueRef = useRef<HTMLButtonElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  /** Once the user has scrolled to the bottom, stays true until the dialog closes (even if they scroll up). */
  const [hasReachedBottomOnce, setHasReachedBottomOnce] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = bodyScrollRef.current;
    if (!el) return;
    if (isScrollAtBottom(el)) setHasReachedBottomOnce(true);
  }, []);

  const handleContinue = useCallback(() => {
    if (!hasReachedBottomOnce) return;
    setPrivacyBriefAcknowledgment();
    onOpenChange(false);
    // Defer until after dialog unmounts so the file picker isn’t blocked by focus/overflow cleanup
    requestAnimationFrame(() => {
      requestAnimationFrame(() => onContinue());
    });
  }, [onContinue, onOpenChange, hasReachedBottomOnce]);

  useEffect(() => {
    if (!open) {
      setHasReachedBottomOnce(false);
      return;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    updateScrollState();
  }, [open, updateScrollState]);

  useEffect(() => {
    if (!open) return;
    const el = bodyScrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(() => updateScrollState());
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, [open, updateScrollState]);

  useEffect(() => {
    if (!open || !hasReachedBottomOnce) return;
    continueRef.current?.focus();
  }, [open, hasReachedBottomOnce]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
      {/* Overlay: intentionally non-interactive (no onClick) — user must acknowledge via the button */}
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] dark:bg-black/70" aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[min(90dvh,720px)] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-[var(--recast-border)]/80 bg-[var(--recast-surface-elevated)] shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute right-2 top-2 z-20 inline-flex h-10 w-10 items-center justify-center rounded-xl text-[var(--recast-text-muted)] transition hover:bg-[var(--recast-surface)]/80 hover:text-[var(--recast-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--recast-accent)]"
          aria-label="Close and return to the landing page"
        >
          <X className="h-5 w-5" strokeWidth={2} />
        </button>
        <div
          ref={bodyScrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-5 pl-5 pr-12 pt-6 sm:pl-6 sm:pr-14 sm:pt-7 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
            <div className="relative mx-auto flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--recast-surface)]/90 ring-1 ring-[var(--recast-border)]/50 sm:mx-0">
              <Image
                src="/logo.svg"
                alt=""
                width={48}
                height={48}
                className="h-full w-full object-contain"
                unoptimized
              />
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className={`${displayFont.className} text-2xl leading-snug tracking-tight text-[var(--recast-text)] sm:text-[1.65rem]`}>
                <span id={titleId}>Before you upload</span>
              </p>
            </div>
          </div>

          <div className="mt-5 w-full text-left sm:mt-4">
            <p className="text-sm leading-relaxed text-[var(--recast-text-muted)]">
              Navis is built to help you understand your medical records — not to store, share, or profit from them.
            </p>
            <p className="mt-3 text-sm font-medium text-[var(--recast-text)]">
              Here&apos;s exactly what happens when you upload a document:
            </p>
          </div>

          <ul className="mt-6 space-y-4">
            {POINTS.map((p) => (
              <li key={p.lead} className="flex gap-3">
                <span
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300"
                  aria-hidden
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
                <div className="min-w-0 text-sm leading-relaxed text-[var(--recast-text-muted)]">
                  <span className="font-semibold text-[var(--recast-text)]">{p.lead}. </span>
                  {p.body}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6">
            <p className="text-sm leading-relaxed text-[var(--recast-text)]">
              Navis is a hackathon prototype built for research and demonstration purposes. It is not a substitute
              for professional medical advice.
            </p>
          </div>
        </div>

        <div className="shrink-0 border-t border-[var(--recast-border)]/50 bg-[var(--recast-surface)]/50 px-5 py-4 sm:px-6">
          <button
            ref={continueRef}
            type="button"
            disabled={!hasReachedBottomOnce}
            onClick={handleContinue}
            title={hasReachedBottomOnce ? undefined : "Scroll to the bottom to continue"}
            className="inline-flex w-full items-center justify-center rounded-xl bg-[var(--recast-accent)] px-4 py-3 text-sm font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.2)_inset] ring-1 ring-[var(--recast-accent-hover)]/30 transition hover:bg-[var(--recast-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--recast-accent)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-[var(--recast-accent)]"
          >
            Sounds good — let&apos;s go
          </button>
          <p className="mt-3 text-center text-xs leading-snug text-[var(--recast-text-muted)]">
            Navis is a research prototype, not a clinical tool.
          </p>
        </div>
      </div>
    </div>
  );
}
