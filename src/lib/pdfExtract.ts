import type { PDFDocumentProxy } from "pdfjs-dist";

const MAX_CHARS = 60_000;

let workerConfigured = false;
const PDF_LOAD_CACHE = new Map<string, Promise<PDFDocumentProxy>>();

export async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (typeof window !== "undefined" && !workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/pdf.worker.min.mjs`;
    workerConfigured = true;
  }
  return pdfjs;
}

export async function loadPdfFromUrl(pdfUrl: string): Promise<PDFDocumentProxy> {
  if (!PDF_LOAD_CACHE.has(pdfUrl)) {
    PDF_LOAD_CACHE.set(
      pdfUrl,
      (async () => {
        const pdfjs = await loadPdfjs();
        const res = await fetch(pdfUrl);
        const buf = await res.arrayBuffer();
        const task = pdfjs.getDocument({ data: buf });
        return task.promise;
      })(),
    );
  }

  return PDF_LOAD_CACHE.get(pdfUrl)!;
}

/** Concatenate text from all pages; truncated to MAX_CHARS. */
export async function extractPdfText(pdfUrl: string): Promise<string> {
  const pdf = await loadPdfFromUrl(pdfUrl);
  const parts: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ("str" in item ? String((item as { str: string }).str) : ""))
      .join(" ");
    parts.push(line);
  }
  const full = parts.join("\n\n").replace(/\s+/g, " ").trim();
  if (full.length <= MAX_CHARS) return full;
  return (
    full.slice(0, MAX_CHARS) +
    "\n\n[… Document text truncated for the voice session context window …]"
  );
}

/** Render page 1 to a JPEG data URL's raw base64 payload (no prefix). */
export async function renderFirstPageJpegBase64(
  pdfUrl: string,
  maxWidth = 900,
): Promise<string> {
  const pdf = await loadPdfFromUrl(pdfUrl);
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(1, maxWidth / viewport.width);
  const scaled = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(scaled.width);
  canvas.height = Math.floor(scaled.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  await page.render({ canvasContext: ctx, viewport: scaled, canvas }).promise;

  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("Invalid JPEG data URL");
  return dataUrl.slice(comma + 1);
}

export function isWeakTextContent(text: string): boolean {
  const t = text.replace(/\s+/g, "").trim();
  return t.length < 40;
}
