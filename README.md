# Recast

**Understand your care. Act with confidence.**

Recast is a patient-facing web app built with [Next.js](https://nextjs.org). It helps people move beyond skimming discharge papers and visit summaries: you upload a PDF, talk about it with an AI assistant grounded in the file, see the relevant parts of the document highlighted as you chat, and export practical artifacts (medication lists, calendar reminders, pharmacy search).

Documents stay in the browser session only—nothing is persisted on Recast’s servers after you leave.

---

## Table of contents

- [What it does](#what-it-does)
- [Features (detailed)](#features-detailed)
- [Tech stack](#tech-stack)
- [Architecture (high level)](#architecture-high-level)
- [Privacy and data](#privacy-and-data)
- [Requirements](#requirements)
- [Environment variables](#environment-variables)
- [Getting started](#getting-started)
- [npm scripts](#npm-scripts)
- [Project structure](#project-structure)
- [Browser permissions](#browser-permissions)
- [Security notes for API keys](#security-notes-for-api-keys)
- [Medical disclaimer](#medical-disclaimer)
- [Roadmap (from the product UI)](#roadmap-from-the-product-ui)

---

## What it does

1. **Landing** — Upload a PDF from your device. The file is held in memory via an object URL and associated with your session.
2. **Document workspace** — A split layout: PDF viewer on the left (large screens) or top (small screens), tools and panels on the right.
3. **Optional AI** — With a Google API key, you can start a **live voice session** (Gemini Live) that reads your document, answers questions, and drives **scroll/highlight** actions on the PDF from the conversation transcript.
4. **Extractions** — With Google and/or Groq keys, the app can extract **critical next steps** and **medication schedules** (JSON via LLM), then offer **PDF** and **ICS** downloads.
5. **Pharmacies** — Enter a U.S. ZIP to open Google Maps with a pharmacy search (no maps API key required).

---

## Features (detailed)

### PDF upload and session-only storage

- Accepts `.pdf` files from the file picker (home and header “Re-upload” on the document page).
- The PDF is exposed to the app as a blob URL; revoking happens when replacing or clearing. There is **no** server-side document store in this codebase.

### PDF rendering and interactive highlights

- Uses **PDF.js** to render pages and text layers.
- Builds a **document index** (per PDF): page text, normalized text for search, detected headings, medication-like terms, and short page summaries for the live model’s system instruction.
- A **transcript parser** watches the assistant’s spoken/text output and triggers:
  - **Scroll to page** when the model references page numbers (digits or words).
  - **Highlight spans** when quoted phrases, headings, or medication-style patterns appear—mapped onto the text layer with normalization and fallback matching.

### “Talk about this document” (Gemini Live)

- Connects to **Google’s Gemini Live** API (`@google/genai`) with model `gemini-3.1-flash-live-preview`.
- **Audio in**: microphone PCM at 16 kHz; configurable VAD (start/end sensitivity, silence duration).
- **Audio out**: decoded PCM chunks played through a small **Web Audio** player; unlock happens in the same user gesture as starting the session to avoid silent output on strict browsers.
- **Text in**: extracted PDF text is truncated locally to **60,000 characters** (`extractPdfText` in `pdfExtract.ts`); that string plus a **document map** (page summaries, up to ~8k chars in the system instruction) is sent to Gemini. If text extraction is weak, the **first page may be sent as a JPEG** for vision-grounded conversation. The **raw PDF file bytes** are not uploaded to Gemini; only derived text and optionally one page image.
- **System instruction** includes a “document map” from the index so the model can reference pages and headings consistently.
- **Transcripts**: input and output transcription are shown in the UI when available.
- **Controls**: mute/unmute (voice mode), stop session, ASL mode (see below).

### Critical next steps

- After document text is available from a live session, **Critical next steps** calls an extractor (Groq or Gemini, depending on env) and shows a numbered list.
- Uses structured JSON output (`gemini-2.0-flash` or Groq `llama-3.3-70b-versatile` with `response_format` / MIME type as appropriate).

### Medication list (PDF) and reminders (.ics)

- **Input context**: document text plus live **heard** and **reply** transcript text, so clarifications from chat can improve extraction.
- Produces structured medication data, then:
  - **PDF** via **jsPDF** + **jspdf-autotable** (sortable medication list).
  - **ICS** via a small builder for calendar import (Google Calendar, Apple Calendar, etc.) when reminder times exist.

Provider selection mirrors critical actions: `NEXT_PUBLIC_MEDICATION_EXTRACT_PROVIDER` (`auto` | `groq` | `gemini`) with `auto` preferring Groq when its key is set.

### Find nearby pharmacies

- Validates a **5-digit U.S. ZIP**, then navigates to a **Google Maps search** URL (`pharmacies near {zip}`). No backend geocoding; opens the user’s browser/maps app.

### ASL fingerspelling assist (camera)

- Optional **MediaPipe** hand landmarks + custom **letter classification** (including calibration JSON under `public/asl/`).
- User can spell in **ASL mode**: microphone is muted, camera captures frames; letters are inferred over a short window and can be **sent as text** into the live session after idle thresholds (space / send).
- Intended as an accessibility-oriented input path alongside voice.

### Landing experience

- Hero, **Upload PDF**, disabled **Use extension** (placeholder).
- **Scroll-driven feature section** (Framer Motion): sticky narrative with one feature at a time, or a **static list** when the user prefers reduced motion.

### Theming

- **Light/dark** toggle with persistence in `localStorage` and a **beforeInteractive** script to avoid flash of wrong theme.

---

## Tech stack

| Area | Choice |
|------|--------|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| Motion | Framer Motion |
| PDF | pdfjs-dist, custom text extraction |
| Live AI | `@google/genai` (Gemini Live) |
| PDF export | jspdf, jspdf-autotable |
| Calendar | Custom `.ics` builder |
| Vision / hands | `@mediapipe/tasks-vision`, TensorFlow.js (where used) |
| Icons | lucide-react |

---

## Architecture (high level)

- **`PdfDocumentProvider`** — Holds `pdfUrl` + `fileName` for the current session.
- **`GeminiLiveDocumentProvider`** — Wraps `useGeminiLiveDocument`: session lifecycle, audio I/O, `documentExtractedText` for downstream panels.
- **`TranscriptPdfViewer`** — Renders PDF, subscribes to live transcripts, runs `TranscriptParser` → scroll/highlight.
- **`documentIndex.ts`** — PDF → structured index + `buildLiveSystemInstruction`.
- **`extractCriticalActions` / `extractMedicationSchedule`** — Client-side fetch to Groq or Google generateContent; shared provider env pattern.

---

## Privacy and data

This section is written for **accuracy** (what the code actually does) and for **sensitive health information**. It is **not** legal or compliance advice.

### What stays on the user’s device (Recast does not host your PDF)

- The **PDF file** is loaded in the browser (blob URL). **This repository has no backend** that stores uploads.
- **Text extraction** and **PDF rendering** run locally via PDF.js.
- When you close the tab or navigate away, Recast’s **in-memory** copy of the session is gone. We do not persist documents in app storage for this flow.

### Important: inference is **not** on-device

The `@google/genai` and Groq HTTP calls run **from the browser**, but the **models run on Google’s and Groq’s servers**. They are **not** scanning a file locally in the sense of “only on your laptop.” Any content you send in an API request is **processed on their infrastructure** for that request (and possibly retained or logged according to **their** policies, not Recast’s).

### What actually gets sent to third-party APIs

| Data | Where it goes | When |
|------|----------------|------|
| **Extracted text** (up to **60k** chars per `extractPdfText`) + **document map** (headings/summaries in the system instruction) | **Google** (Gemini Live) | Starting “Talk about this document” |
| **First-page JPEG** (base64) | **Google** (Gemini Live) | Only when extracted text is “weak” (scanned PDFs, etc.) |
| **Microphone audio** (PCM) | **Google** (Gemini Live) | While the live session is active and unmuted |
| **ASL / typed text** you send into the session | **Google** (Gemini Live) | When you use spelling or text input |
| **Document text** (same extracted text used in-app) | **Google** and/or **Groq** | Critical steps + medication extraction requests |
| **Chat transcripts** (`heardText` / `replyText`) | **Google** and/or **Groq** | Medication extraction only (bundled in the prompt) |

The **binary PDF** is **not** sent as a whole file to Gemini; **derived** text and optionally **one rasterized page** are.

### “After we close the website, do they still have the document?”

- **Recast** does not keep a copy—there is no Recast server database for the file in this codebase.
- **Google** and **Groq** may retain **API logs**, **billing records**, or **content** under their **terms of service**, **privacy policy**, and **data retention** practices. Those can differ by product (e.g. consumer vs. enterprise), region, and settings. **Closing the tab does not guarantee** that a provider immediately deletes all traces of the request from their systems.
- For **regulated health data** (e.g. U.S. HIPAA), using consumer or default API tiers may **not** meet requirements. You typically need **appropriate agreements** (e.g. BAA where applicable), **enterprise** offerings, **regional** endpoints, and a **formal** risk assessment—not just “we don’t store it.”


---

## Requirements

- **Node.js** (LTS recommended) and npm (or compatible package manager).
- A modern **Chromium-, Firefox-, or Safari-class** browser with Web Audio, `getUserMedia` for mic (voice chat) and optionally camera (ASL).

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in values. All listed keys are **public** (`NEXT_PUBLIC_*`) and are bundled for client-side use—**restrict keys** in Google AI Studio / Groq by HTTP referrer (and never commit real keys).

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_GOOGLE_API_KEY` | **Required** for “Talk about this document” (Gemini Live). Also used for JSON extractions when Groq is not selected. |
| `NEXT_PUBLIC_GROQ_API_KEY` | Optional; used for medication/critical-step extraction when provider is `auto` (preferred if set) or `groq`. |
| `NEXT_PUBLIC_MEDICATION_EXTRACT_PROVIDER` | `auto` (default), `groq`, or `gemini`—controls which API runs structured extractions. |

The marketing site works without keys; **document AI features** need at least one valid key as described above.

---

## Getting started

```bash
npm install
cp .env.example .env.local
# Edit .env.local — add at least NEXT_PUBLIC_GOOGLE_API_KEY for voice chat
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), upload a PDF, then open the document page.

---

## npm scripts

| Script | Command |
|--------|---------|
| Development | `npm run dev` |
| Production build | `npm run build` |
| Start production server | `npm start` |
| Lint | `npm run lint` |

---

## Project structure

```
src/
  app/                 # Next.js App Router — pages, layout, global CSS
  components/          # UI: viewer, panels, header, providers, features
  hooks/               # useGeminiLiveDocument (Gemini Live session)
  lib/
    asl/               # Hand landmarks, letter classification
    criticalActions/   # Extract + parse critical steps
    ics/               # Build .ics from medication reminders
    maps/              # External map URLs (Google Maps search)
    medications/       # Extract, parse, PDF export
    geminiLiveAudio.ts # Mic capture + PCM playback
    documentIndex.ts   # PDF index + live system instruction
    pdfExtract.ts      # PDF.js loading, text + first-page image
    transcriptParser.ts# Transcript → scroll/highlight actions
public/
  asl/                 # Optional ASL calibration JSON
  logo.svg
```

---

## Browser permissions

- **Microphone**: requested when you start a live voice session.
- **Camera**: used only when using ASL fingerspelling mode.

---

## Security notes for API keys

- Prefer **restricted** browser keys (referrer / bundle restrictions).
- Never ship unrestricted production keys in public repos.
- `NEXT_PUBLIC_*` variables are exposed to the client by design.

---

## Medical disclaimer

Recast is a **tool to help you read and organize information**. It does **not** provide medical advice, diagnosis, or treatment. Always follow your clinician’s instructions and verify medications and plans with a licensed professional or pharmacist.

---

## Roadmap (from the product UI)

- **Browser extension** — “Coming soon” on the home page; work with documents from the web without leaving your workflow.
- **Dedicated multilingual UI** — The landing page describes choosing a language for explanations; the live system instruction is English-forward for plain-language explanations. A future settings control may align the product with that copy explicitly.

---

## License / contributing

This is a private project (`"private": true` in `package.json`). Adjust as needed for your team.

---

Built with [Next.js](https://nextjs.org) and deployed-ready for static + Node hosting patterns supported by Next.js 16.
