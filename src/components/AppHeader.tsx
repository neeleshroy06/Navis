"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import { Upload } from "lucide-react";
import { usePdfDocument } from "@/components/PdfDocumentContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { isPdfFile } from "@/lib/pdf";

type Props = {
  showReupload?: boolean;
};

export function AppHeader({ showReupload = false }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setPdfFromFile } = usePdfDocument();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !isPdfFile(file)) return;
    setPdfFromFile(file);
  };

  return (
    <header className="shrink-0 border-b border-[var(--recast-border)]/50 bg-[var(--recast-header-bg)] px-4 py-4 backdrop-blur-md sm:px-8">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        tabIndex={-1}
        onChange={handleFileChange}
      />
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 rounded-lg outline-offset-4 transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--recast-accent)]"
        >
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--recast-surface-elevated)]/80 ring-1 ring-[var(--recast-border)]/50">
            <Image
              src="/logo.svg"
              alt=""
              width={40}
              height={40}
              className="h-full w-full object-contain"
              unoptimized
            />
          </div>
          <span className="text-xl font-semibold tracking-tight text-[var(--recast-text)] sm:text-2xl">
            Navis
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {showReupload ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Upload PDF"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--recast-border)] bg-[var(--recast-surface-elevated)]/90 px-3 py-2 text-sm font-medium text-[var(--recast-text)] shadow-sm transition hover:border-[var(--recast-accent)] hover:text-[var(--recast-accent)] sm:px-4"
            >
              <Upload className="h-4 w-4 shrink-0" strokeWidth={2} />
              Upload
            </button>
          ) : null}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
