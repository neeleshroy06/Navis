"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, FileText, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGeminiLiveDocumentContext } from "@/components/GeminiLiveDocumentProvider";
import { buildDocumentIndexFromUrl, normalizeSearchText, type DocumentIndex } from "@/lib/documentIndex";
import { loadPdfFromUrl, loadPdfjs } from "@/lib/pdfExtract";
import { isTranscriptContinuation, TranscriptParser, type DocumentAction } from "@/lib/transcriptParser";

type HighlightStyle = "default" | "heading";

type SpanMappingEntry = {
  span: HTMLSpanElement | null;
  localOffset: number;
};

type PageViewProps = {
  pdfDocument: PDFDocumentProxy;
  pageNumber: number;
  registerPageElement: (pageNumber: number, element: HTMLDivElement | null) => void;
  registerTextLayer: (pageNumber: number, element: HTMLDivElement | null) => void;
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isRenderCancellation(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: string }).name === "RenderingCancelledException"
  );
}

function buildNormalizedSpanMap(spans: HTMLSpanElement[]) {
  let normalizedText = "";
  const charMap: SpanMappingEntry[] = [];
  let lastWasSpace = true;

  const pushNormalizedChunk = (chunk: string, entry: SpanMappingEntry) => {
    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index];
      if (char === " ") {
        if (lastWasSpace) {
          continue;
        }
        lastWasSpace = true;
      } else {
        lastWasSpace = false;
      }

      normalizedText += char;
      charMap.push(entry);
    }
  };

  spans.forEach((span, spanIndex) => {
    const text = span.textContent ?? "";
    for (let offset = 0; offset < text.length; offset += 1) {
      const normalizedChar = normalizeSearchText(text[offset]);
      if (!normalizedChar) {
        continue;
      }
      pushNormalizedChunk(normalizedChar, { span, localOffset: offset });
    }

    if (spanIndex < spans.length - 1) {
      pushNormalizedChunk(" ", { span: null, localOffset: -1 });
    }
  });

  return { normalizedText, charMap };
}

function wrapSpanHighlight(
  span: HTMLSpanElement,
  startOffset: number,
  endOffset: number,
  style: HighlightStyle,
  activeHighlights: HTMLElement[],
) {
  if (span.querySelector(".recast-highlight")) {
    return;
  }

  const text = span.textContent ?? "";
  const before = text.slice(0, startOffset);
  const matched = text.slice(startOffset, endOffset);
  const after = text.slice(endOffset);

  if (!matched) {
    return;
  }

  const mark = document.createElement("mark");
  mark.className = `recast-highlight recast-highlight-${style}`;
  mark.textContent = matched;

  span.textContent = "";
  if (before) {
    span.appendChild(document.createTextNode(before));
  }
  span.appendChild(mark);
  if (after) {
    span.appendChild(document.createTextNode(after));
  }

  activeHighlights.push(mark);
}

function applyHighlightToLayer(
  textLayer: HTMLDivElement,
  searchText: string,
  style: HighlightStyle,
  activeHighlights: HTMLElement[],
) {
  const spans = Array.from(textLayer.querySelectorAll("span")) as HTMLSpanElement[];
  if (!spans.length) {
    return false;
  }

  const { normalizedText, charMap } = buildNormalizedSpanMap(spans);
  const normalizedSearch = normalizeSearchText(searchText);
  if (!normalizedSearch) {
    return false;
  }

  let matchStart = normalizedText.indexOf(normalizedSearch);
  let matchEnd = matchStart + normalizedSearch.length;

  if (matchStart === -1) {
    const fallbackToken = normalizedSearch.split(" ").find((token) => token.length >= 5);
    if (!fallbackToken) {
      return false;
    }
    matchStart = normalizedText.indexOf(fallbackToken);
    if (matchStart === -1) {
      return false;
    }
    matchEnd = matchStart + fallbackToken.length;
  }

  const spanRanges = new Map<HTMLSpanElement, { start: number; end: number }>();

  for (let index = matchStart; index < matchEnd && index < charMap.length; index += 1) {
    const entry = charMap[index];
    if (!entry?.span) {
      continue;
    }

    const existing = spanRanges.get(entry.span);
    if (!existing) {
      spanRanges.set(entry.span, { start: entry.localOffset, end: entry.localOffset });
      continue;
    }

    existing.end = entry.localOffset;
  }

  if (!spanRanges.size) {
    return false;
  }

  spanRanges.forEach((range, span) => {
    wrapSpanHighlight(span, range.start, range.end + 1, style, activeHighlights);
  });

  return true;
}

function PdfPageView({
  pdfDocument,
  pageNumber,
  registerPageElement,
  registerTextLayer,
}: PageViewProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [pageWidth, setPageWidth] = useState<number | null>(null);
  const [pageHeight, setPageHeight] = useState<number | null>(null);

  useEffect(() => {
    registerPageElement(pageNumber, shellRef.current);
    registerTextLayer(pageNumber, textLayerRef.current);
    return () => {
      registerPageElement(pageNumber, null);
      registerTextLayer(pageNumber, null);
    };
  }, [pageNumber, registerPageElement, registerTextLayer]);

  useEffect(() => {
    const element = shellRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.max(element.clientWidth - 32, 280);
      setPageWidth(nextWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel?: () => void; promise?: Promise<unknown> } | null = null;
    let textLayerInstance: { cancel?: () => void; render: () => Promise<unknown> } | null = null;

    const renderPage = async () => {
      if (!pageWidth || !canvasRef.current || !textLayerRef.current) {
        return;
      }

      const page = await pdfDocument.getPage(pageNumber);
      if (cancelled) {
        return;
      }

      const baseViewport = page.getViewport({ scale: 1 });
      const scale = pageWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const outputScale = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      const textLayer = textLayerRef.current;
      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      setPageHeight(viewport.height);

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

      renderTask = page.render({ canvasContext: context, viewport, canvas });
      try {
        await renderTask.promise;
      } catch (error) {
        if (!cancelled && !isRenderCancellation(error)) {
          throw error;
        }
        return;
      }
      if (cancelled) {
        return;
      }

      textLayer.innerHTML = "";
      textLayer.style.width = `${viewport.width}px`;
      textLayer.style.height = `${viewport.height}px`;
      textLayer.style.setProperty("--scale-factor", `${scale}`);

      const textContent = await page.getTextContent();
      if (cancelled) {
        return;
      }

      const pdfjs = await loadPdfjs();
      if (cancelled) {
        return;
      }

      textLayerInstance = new pdfjs.TextLayer({
        container: textLayer,
        textContentSource: textContent,
        viewport,
      });
      try {
        await textLayerInstance.render();
      } catch (error) {
        if (!cancelled && !isRenderCancellation(error)) {
          throw error;
        }
        return;
      }

      if (!cancelled) {
        registerTextLayer(pageNumber, textLayer);
      }
    };

    void renderPage().catch((error: unknown) => {
      if (!isRenderCancellation(error)) {
        console.error("Failed to render PDF page", pageNumber, error);
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel?.();
      textLayerInstance?.cancel?.();
    };
  }, [pageNumber, pageWidth, pdfDocument, registerTextLayer]);

  return (
    <div ref={shellRef} className="w-full scroll-mt-4">
      <div
        data-page-number={pageNumber}
        className="recast-pdf-page"
        style={{
          width: pageWidth ?? undefined,
          minHeight: pageHeight ?? 420,
        }}
      >
        <canvas ref={canvasRef} className="recast-pdf-canvas" />
        <div ref={textLayerRef} className="recast-pdf-text-layer" />
      </div>
      <p className="mt-2 text-center text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--recast-text-muted)]/75">
        Page {pageNumber}
      </p>
    </div>
  );
}

export function TranscriptPdfViewer({
  pdfUrl,
  fileName,
}: {
  pdfUrl: string;
  fileName: string | null;
}) {
  const { replyText, status } = useGeminiLiveDocumentContext();
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [documentIndex, setDocumentIndex] = useState<DocumentIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [referencedPage, setReferencedPage] = useState<number | null>(null);
  const [indicatorVisible, setIndicatorVisible] = useState(false);

  const viewerScrollRef = useRef<HTMLDivElement | null>(null);
  const parserRef = useRef<TranscriptParser | null>(null);
  const previousReplyRef = useRef("");
  const actionQueueRef = useRef(Promise.resolve());
  const responseVersionRef = useRef(0);
  const indicatorTimerRef = useRef<number | null>(null);
  const activeHighlightsRef = useRef<HTMLElement[]>([]);
  const pageElementsRef = useRef(new Map<number, HTMLDivElement>());
  const textLayerRef = useRef(new Map<number, HTMLDivElement>());

  const pageNumbers = useMemo(() => {
    if (!pdfDocument) {
      return [];
    }
    return Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);
  }, [pdfDocument]);

  const clearHighlights = useCallback(() => {
    for (const highlight of activeHighlightsRef.current) {
      const parent = highlight.parentNode;
      if (!parent) {
        continue;
      }
      parent.replaceChild(document.createTextNode(highlight.textContent ?? ""), highlight);
      parent.normalize();
    }
    activeHighlightsRef.current = [];
  }, []);

  const flashIndicator = useCallback((pageNumber: number) => {
    setReferencedPage(pageNumber);
    setIndicatorVisible(true);

    if (indicatorTimerRef.current) {
      window.clearTimeout(indicatorTimerRef.current);
    }

    indicatorTimerRef.current = window.setTimeout(() => {
      setIndicatorVisible(false);
    }, 4000);
  }, []);

  const waitForTextLayer = useCallback(async (pageNumber: number) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const layer = textLayerRef.current.get(pageNumber);
      if (layer && layer.children.length > 0) {
        return layer;
      }
      await sleep(100);
    }
    return null;
  }, []);

  const scrollToPage = useCallback(
    async (pageNumber: number) => {
      const container = viewerScrollRef.current;
      const pageElement = pageElementsRef.current.get(pageNumber);
      if (!container || !pageElement) {
        return;
      }

      const top = Math.max(pageElement.offsetTop - 12, 0);
      container.scrollTo({ top, behavior: "smooth" });
      flashIndicator(pageNumber);
      setCurrentPage(pageNumber);
      await sleep(220);
    },
    [flashIndicator],
  );

  const highlightText = useCallback(
    async (searchText: string, pageNumber: number | null, style: HighlightStyle = "default") => {
      if (!pageNumber) {
        return;
      }

      const layer = await waitForTextLayer(pageNumber);
      if (!layer) {
        return;
      }

      applyHighlightToLayer(layer, searchText, style, activeHighlightsRef.current);
    },
    [waitForTextLayer],
  );

  const beginNewResponse = useCallback(() => {
    responseVersionRef.current += 1;
    parserRef.current?.reset();
    clearHighlights();
    setReferencedPage(null);
    setIndicatorVisible(false);
  }, [clearHighlights]);

  const executeActions = useCallback(
    async (actions: DocumentAction[], responseVersion: number) => {
      for (const action of actions) {
        if (responseVersion !== responseVersionRef.current) {
          return;
        }

        if (action.type === "scroll_to_page") {
          await scrollToPage(action.page);
          continue;
        }

        if (action.page) {
          await scrollToPage(action.page);
          await sleep(260);
        }

        await highlightText(action.text, action.page, action.style ?? "default");
      }
    },
    [highlightText, scrollToPage],
  );

  const enqueueActions = useCallback(
    (actions: DocumentAction[]) => {
      const responseVersion = responseVersionRef.current;
      actionQueueRef.current = actionQueueRef.current
        .then(() => executeActions(actions, responseVersion))
        .catch(() => undefined);
    },
    [executeActions],
  );

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    setLoadError(null);
    setPdfDocument(null);
    setDocumentIndex(null);
    setCurrentPage(1);
    previousReplyRef.current = "";
    beginNewResponse();

    const load = async () => {
      try {
        const [pdf, index] = await Promise.all([
          loadPdfFromUrl(pdfUrl),
          buildDocumentIndexFromUrl(pdfUrl),
        ]);

        if (cancelled) {
          return;
        }

        setPdfDocument(pdf);
        setDocumentIndex(index);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "Unable to render this PDF.";
        setLoadError(message);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      parserRef.current?.reset();
      clearHighlights();
    };
  }, [beginNewResponse, clearHighlights, pdfUrl]);

  useEffect(() => {
    if (!documentIndex) {
      parserRef.current = null;
      return;
    }

    parserRef.current = new TranscriptParser(documentIndex, enqueueActions);
    return () => {
      parserRef.current?.reset();
    };
  }, [documentIndex, enqueueActions]);

  useEffect(() => {
    if (status === "idle" || status === "connecting") {
      previousReplyRef.current = "";
      beginNewResponse();
      return;
    }

    const nextReply = replyText.trim();
    if (!nextReply || !parserRef.current) {
      return;
    }

    const previousReply = previousReplyRef.current;
    if (!previousReply || !isTranscriptContinuation(previousReply, nextReply)) {
      beginNewResponse();
    }

    previousReplyRef.current = nextReply;
    parserRef.current.updateTranscript(nextReply);
  }, [beginNewResponse, replyText, status]);

  useEffect(() => {
    const container = viewerScrollRef.current;
    if (!container || !pageNumbers.length) {
      return;
    }

    const updateCurrentPage = () => {
      const midpoint = container.scrollTop + container.clientHeight * 0.35;
      let nextPage = pageNumbers[0];
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const pageNumber of pageNumbers) {
        const pageElement = pageElementsRef.current.get(pageNumber);
        if (!pageElement) {
          continue;
        }

        const distance = Math.abs(pageElement.offsetTop - midpoint);
        if (distance < closestDistance) {
          closestDistance = distance;
          nextPage = pageNumber;
        }
      }

      setCurrentPage(nextPage);
    };

    updateCurrentPage();
    container.addEventListener("scroll", updateCurrentPage, { passive: true });
    return () => container.removeEventListener("scroll", updateCurrentPage);
  }, [pageNumbers]);

  useEffect(() => {
    return () => {
      if (indicatorTimerRef.current) {
        window.clearTimeout(indicatorTimerRef.current);
      }
    };
  }, []);

  const goToPage = useCallback(
    async (pageNumber: number) => {
      const boundedPage = Math.min(Math.max(pageNumber, 1), pageNumbers.length || 1);
      await scrollToPage(boundedPage);
    },
    [pageNumbers.length, scrollToPage],
  );

  const canGoPrev = currentPage > 1;
  const canGoNext = currentPage < pageNumbers.length;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--recast-border)]/50 bg-[var(--recast-surface-elevated)]/55 shadow-inner ring-1 ring-[var(--recast-border)]/30">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--recast-border)]/40 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--recast-text-muted)]">
            Document viewer
          </p>
          <p className="truncate text-sm text-[var(--recast-text)]">
            {fileName ?? "Uploaded PDF"}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--recast-border)]/60 bg-[var(--recast-surface)]/70 px-3 py-1 text-[11px] font-medium text-[var(--recast-text-muted)]">
          <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {pdfDocument ? `${pdfDocument.numPages} pages` : "Preparing PDF"}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-[var(--recast-border)]/30 bg-[var(--recast-surface-elevated)]/92 px-4 py-2.5">
        <div className="text-xs font-medium text-[var(--recast-text-muted)]">
          Viewing page <span className="text-[var(--recast-text)]">{currentPage}</span>
          {pageNumbers.length ? ` of ${pageNumbers.length}` : ""}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canGoPrev}
            onClick={() => void goToPage(currentPage - 1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--recast-border)] bg-[var(--recast-surface)] text-[var(--recast-text)] transition hover:border-[var(--recast-accent)] hover:text-[var(--recast-accent)] disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="Go to previous page"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            disabled={!canGoNext}
            onClick={() => void goToPage(currentPage + 1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--recast-border)] bg-[var(--recast-surface)] text-[var(--recast-text)] transition hover:border-[var(--recast-accent)] hover:text-[var(--recast-accent)] disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="Go to next page"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div
        ref={viewerScrollRef}
        className="recast-pdf-scroll-area relative min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
      >
        {isLoading ? (
          <div className="flex h-full min-h-[40vh] items-center justify-center gap-2 text-sm text-[var(--recast-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            Rendering PDF and indexing text…
          </div>
        ) : loadError ? (
          <div className="flex h-full min-h-[40vh] items-center justify-center px-6 text-center text-sm text-red-600 dark:text-red-400">
            {loadError}
          </div>
        ) : pdfDocument ? (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
            {pageNumbers.map((pageNumber) => (
              <PdfPageView
                key={pageNumber}
                pdfDocument={pdfDocument}
                pageNumber={pageNumber}
                registerPageElement={(page, element) => {
                  if (element) {
                    pageElementsRef.current.set(page, element);
                  } else {
                    pageElementsRef.current.delete(page);
                  }
                }}
                registerTextLayer={(page, element) => {
                  if (element) {
                    textLayerRef.current.set(page, element);
                  } else {
                    textLayerRef.current.delete(page);
                  }
                }}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div
        className={`pointer-events-none absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full border border-[var(--recast-border)]/70 bg-[var(--recast-surface-elevated)]/95 px-4 py-2 text-xs font-medium text-[var(--recast-accent)] shadow-lg transition-all duration-300 ${
          indicatorVisible && referencedPage ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
        }`}
      >
        {referencedPage ? `Gemini is looking at -> Page ${referencedPage}` : "Gemini is looking at ->"}
      </div>
    </div>
  );
}
