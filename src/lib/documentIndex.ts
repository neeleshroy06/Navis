import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfFromUrl } from "@/lib/pdfExtract";

type TextLikeItem = {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
};

export type IndexedPdfPage = {
  pageNumber: number;
  rawText: string;
  normalizedText: string;
  headings: string[];
  terms: string[];
  summary: string;
};

export type DocumentIndex = {
  pageCount: number;
  pages: Record<number, IndexedPdfPage>;
  headingMap: Record<string, number>;
  termMap: Record<string, number[]>;
  pageSummary: string;
};

const DOCUMENT_INDEX_CACHE = new Map<string, Promise<DocumentIndex>>();

const MEDICATION_REGEX =
  /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}\s+\d+(?:\.\d+)?\s?(?:mg|mcg|g|mL|ml|units?|tabs?|tablets?|caps?|mcL))(?:\s+(?:PO|IV|IM|SQ|BID|TID|QID|PRN|daily|once daily|twice daily))?\b/g;

const SECTION_KEYWORDS = [
  "plan",
  "instructions",
  "care",
  "summary",
  "medications",
  "medication",
  "diagnosis",
  "follow-up",
  "follow up",
  "warning",
  "warnings",
  "treatment",
  "discharge",
  "history",
  "assessment",
];

export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.%/+\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapePromptLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function isTextItem(item: unknown): item is TextLikeItem {
  return Boolean(item && typeof item === "object" && "str" in (item as TextLikeItem));
}

function collectPageLines(items: unknown[]): string[] {
  const lines: string[] = [];
  let current = "";
  let currentY: number | null = null;

  const flush = () => {
    const text = current.replace(/\s+/g, " ").trim();
    if (text) {
      lines.push(text);
    }
    current = "";
    currentY = null;
  };

  for (const item of items) {
    if (!isTextItem(item) || !item.str?.trim()) {
      continue;
    }

    const y = typeof item.transform?.[5] === "number" ? Math.round(item.transform[5]) : null;
    const shouldBreak = current && y !== null && currentY !== null && Math.abs(y - currentY) > 2;

    if (shouldBreak) {
      flush();
    }

    current += `${current ? " " : ""}${item.str}`;
    currentY = y ?? currentY;

    if (item.hasEOL) {
      flush();
    }
  }

  flush();
  return lines;
}

function isHeadingCandidate(line: string): boolean {
  const trimmed = line.replace(/\s+/g, " ").trim();
  if (trimmed.length < 4 || trimmed.length > 90) {
    return false;
  }

  const lettersOnly = trimmed.replace(/[^A-Za-z]/g, "");
  if (lettersOnly.length < 4) {
    return false;
  }

  const uppercaseRatio =
    lettersOnly.split("").filter((char) => char === char.toUpperCase()).length / lettersOnly.length;

  if (uppercaseRatio >= 0.85) {
    return true;
  }

  const normalized = normalizeSearchText(trimmed);
  return (
    normalized.split(" ").length <= 8 &&
    SECTION_KEYWORDS.some((keyword) => normalized.includes(keyword))
  );
}

function extractTerms(rawText: string): string[] {
  const matched = [...rawText.matchAll(MEDICATION_REGEX)].map((entry) => entry[0].trim());
  return unique(matched).slice(0, 12);
}

function summarisePage(headings: string[], terms: string[]): string {
  if (!headings.length && !terms.length) {
    return "general document content";
  }

  const parts: string[] = [];
  if (headings.length) {
    parts.push(`Headings: ${headings.slice(0, 2).join(", ")}`);
  }
  if (terms.length) {
    parts.push(`Key terms: ${terms.slice(0, 5).join(", ")}`);
  }
  return parts.join(" | ");
}

export async function buildDocumentIndex(pdfDocument: PDFDocumentProxy): Promise<DocumentIndex> {
  const pages: Record<number, IndexedPdfPage> = {};
  const headingMap: Record<string, number> = {};
  const termMap: Record<string, number[]> = {};

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items = textContent.items as unknown[];
    const rawText = items
      .filter(isTextItem)
      .map((item) => item.str?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const lines = collectPageLines(items);
    const headings = unique(lines.filter(isHeadingCandidate)).slice(0, 8);
    const terms = extractTerms(rawText);
    const normalizedText = normalizeSearchText(rawText);

    pages[pageNumber] = {
      pageNumber,
      rawText,
      normalizedText,
      headings,
      terms,
      summary: summarisePage(headings, terms),
    };

    for (const heading of headings) {
      headingMap[normalizeSearchText(heading)] = pageNumber;
    }

    for (const term of terms) {
      const normalizedTerm = normalizeSearchText(term);
      if (!normalizedTerm) {
        continue;
      }
      if (!termMap[normalizedTerm]) {
        termMap[normalizedTerm] = [];
      }
      if (!termMap[normalizedTerm].includes(pageNumber)) {
        termMap[normalizedTerm].push(pageNumber);
      }
    }
  }

  const pageSummary = Object.values(pages)
    .map((page) => `Page ${page.pageNumber}: ${escapePromptLine(page.summary)}`)
    .join("\n");

  return {
    pageCount: pdfDocument.numPages,
    pages,
    headingMap,
    termMap,
    pageSummary,
  };
}

export function buildDocumentIndexFromUrl(pdfUrl: string): Promise<DocumentIndex> {
  if (!DOCUMENT_INDEX_CACHE.has(pdfUrl)) {
    DOCUMENT_INDEX_CACHE.set(
      pdfUrl,
      (async () => {
        const pdf = await loadPdfFromUrl(pdfUrl);
        return buildDocumentIndex(pdf);
      })(),
    );
  }

  return DOCUMENT_INDEX_CACHE.get(pdfUrl)!;
}

export function buildLiveSystemInstruction(index: DocumentIndex | null): string {
  const baseInstruction =
    "You are a compassionate assistant helping the user understand a document (often health-related). " +
    "Answer in short, clear spoken sentences. Speak naturally, like a human-to-human conversation. " +
    "Stay grounded in the uploaded document. If something is missing or unclear, ask a brief clarifying question.";

  if (!index) {
    return baseInstruction;
  }

  const structure = index.pageSummary.slice(0, 8_000);

  return [
    baseInstruction,
    "",
    "Document map:",
    structure,
    "",
    "Reference rules:",
    '- When you mention a page, say "page X".',
    "- When you mention a quoted phrase from the document, use double quotes around the exact text when possible.",
    "- When you mention a section heading, prefer the exact heading text from the document.",
    "- Explain medical language in plain English.",
  ].join("\n");
}
