import { normalizeSearchText, type DocumentIndex } from "@/lib/documentIndex";

export type DocumentAction =
  | { type: "scroll_to_page"; page: number; priority: number }
  | {
      type: "highlight_text";
      page: number | null;
      text: string;
      priority: number;
      style?: "default" | "heading";
    };

type ParserCallback = (actions: DocumentAction[]) => void;

const PAGE_NUMBER_PATTERN = /\bpage(?:s)?\s+(\d+)(?:\s*(?:,|and)\s*(\d+))?\b/gi;
const PAGE_WORD_PATTERN =
  /\bpage\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi;
const PAGE_ORDINAL_PATTERN =
  /\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+page\b/gi;
const QUOTED_TEXT_PATTERN = /"([^"]{3,120})"/g;
const DRUG_DOSAGE_PATTERN =
  /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}\s+\d+(?:\.\d+)?\s?(?:mg|mcg|g|mL|ml|units?))(?:\s+(?:PO|IV|IM|SQ|BID|TID|QID|PRN|daily|once daily|twice daily))?\b/g;

const WORD_TO_NUM: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
};

const STOP_WORDS = new Set([
  "page",
  "section",
  "under",
  "with",
  "your",
  "from",
  "that",
  "this",
  "what",
  "when",
  "have",
  "been",
  "into",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function significantWords(text: string): string[] {
  return normalizeSearchText(text)
    .split(" ")
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

export function isTranscriptContinuation(previous: string, next: string): boolean {
  const prev = previous.trim();
  const current = next.trim();

  if (!prev || !current) {
    return true;
  }

  return current.startsWith(prev) || prev.startsWith(current);
}

export class TranscriptParser {
  private accumulatedText = "";
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private firedActions = new Set<string>();
  private lastPageReferenced: number | null = null;

  constructor(
    private readonly documentIndex: DocumentIndex,
    private readonly onActions: ParserCallback,
  ) {}

  updateTranscript(text: string) {
    this.accumulatedText = text;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.parse(), 120);
  }

  reset() {
    this.accumulatedText = "";
    this.firedActions.clear();
    this.lastPageReferenced = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private parse() {
    const text = this.accumulatedText;
    if (!text.trim()) {
      return;
    }

    const actions: DocumentAction[] = [];

    let match: RegExpExecArray | null;

    const pageNumberPattern = new RegExp(PAGE_NUMBER_PATTERN.source, "gi");
    while ((match = pageNumberPattern.exec(text)) !== null) {
      const firstPage = Number.parseInt(match[1], 10);
      if (this.isValidPage(firstPage)) {
        actions.push({ type: "scroll_to_page", page: firstPage, priority: 1 });
      }
      const secondPage = Number.parseInt(match[2] ?? "", 10);
      if (this.isValidPage(secondPage)) {
        actions.push({ type: "scroll_to_page", page: secondPage, priority: 3 });
      }
    }

    const pageWordPattern = new RegExp(PAGE_WORD_PATTERN.source, "gi");
    while ((match = pageWordPattern.exec(text)) !== null) {
      const page = WORD_TO_NUM[match[1].toLowerCase()];
      if (this.isValidPage(page)) {
        actions.push({ type: "scroll_to_page", page, priority: 1 });
      }
    }

    const pageOrdinalPattern = new RegExp(PAGE_ORDINAL_PATTERN.source, "gi");
    while ((match = pageOrdinalPattern.exec(text)) !== null) {
      const page = WORD_TO_NUM[match[1].toLowerCase()];
      if (this.isValidPage(page)) {
        actions.push({ type: "scroll_to_page", page, priority: 1 });
      }
    }

    const quotedPattern = new RegExp(QUOTED_TEXT_PATTERN.source, "g");
    while ((match = quotedPattern.exec(text)) !== null) {
      const quoted = match[1].trim();
      if (!quoted) {
        continue;
      }
      actions.push({
        type: "highlight_text",
        text: quoted,
        page: this.findTextPage(quoted) ?? this.lastPageReferenced,
        priority: 2,
      });
    }

    const drugPattern = new RegExp(DRUG_DOSAGE_PATTERN.source, "g");
    while ((match = drugPattern.exec(text)) !== null) {
      const term = match[0].trim();
      const page = this.findTextPage(term);
      if (page) {
        actions.push({
          type: "highlight_text",
          text: term,
          page,
          priority: 2,
        });
      }
    }

    const normalizedTranscript = normalizeSearchText(text);
    for (const [heading, page] of Object.entries(this.documentIndex.headingMap)) {
      const words = significantWords(heading);
      if (words.length < 2) {
        continue;
      }

      const anchorWords = words.slice(0, 3);
      const exactMatch = normalizedTranscript.includes(heading);
      const fuzzyMatch = anchorWords.every((word) =>
        new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(normalizedTranscript),
      );

      if (!exactMatch && !fuzzyMatch) {
        continue;
      }

      actions.push({ type: "scroll_to_page", page, priority: 1 });
      actions.push({
        type: "highlight_text",
        text: heading,
        page,
        priority: 2,
        style: "heading",
      });
    }

    const uniqueActions = actions.filter((action) => {
      const textKey = action.type === "highlight_text" ? `:${normalizeSearchText(action.text)}` : "";
      const actionKey = `${action.type}:${action.page ?? "none"}${textKey}`;
      if (this.firedActions.has(actionKey)) {
        return false;
      }
      this.firedActions.add(actionKey);
      return true;
    });

    uniqueActions.sort((a, b) => a.priority - b.priority);
    for (const action of uniqueActions) {
      if (action.type === "scroll_to_page") {
        this.lastPageReferenced = action.page;
      }
    }

    if (uniqueActions.length) {
      this.onActions(uniqueActions);
    }
  }

  private isValidPage(page: number) {
    return Number.isFinite(page) && page >= 1 && page <= this.documentIndex.pageCount;
  }

  private findTextPage(text: string): number | null {
    const normalizedNeedle = normalizeSearchText(text);
    if (!normalizedNeedle) {
      return null;
    }

    for (const page of Object.values(this.documentIndex.pages)) {
      if (page.normalizedText.includes(normalizedNeedle)) {
        return page.pageNumber;
      }
    }

    const tokens = significantWords(normalizedNeedle).slice(0, 2);
    if (!tokens.length) {
      return null;
    }

    for (const page of Object.values(this.documentIndex.pages)) {
      if (tokens.every((token) => page.normalizedText.includes(token))) {
        return page.pageNumber;
      }
    }

    const termPages = this.documentIndex.termMap[normalizedNeedle];
    return termPages?.[0] ?? null;
  }
}
