"use client";

import {
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import { useCallback, useRef, useState } from "react";
import {
  LIVE_OUTPUT_SAMPLE_RATE,
  PcmChunkPlayer,
  startMicPcmCapture,
  type MicCapture,
} from "@/lib/geminiLiveAudio";
import {
  extractRedactedPdfText,
  isWeakTextContent,
  renderFirstPageJpegBase64,
} from "@/lib/pdfExtract";
import {
  buildDocumentIndexFromUrl,
  buildLiveSystemInstruction,
  type DocumentIndex,
} from "@/lib/documentIndex";
import type { PhiRedactionSummary } from "@/lib/phiRedaction";

export type LiveDocStatus = "idle" | "connecting" | "live" | "error";

export type LiveInputMode = "voice" | "asl";

function getServerContent(msg: LiveServerMessage): Record<string, unknown> | undefined {
  const raw = msg as unknown as Record<string, unknown>;
  return (raw.serverContent ?? raw.server_content) as Record<string, unknown> | undefined;
}

function getModelTurnParts(msg: LiveServerMessage): unknown[] {
  const sc = getServerContent(msg);
  const mt = (sc?.modelTurn ?? sc?.model_turn) as Record<string, unknown> | undefined;
  return (mt?.parts as unknown[]) ?? [];
}

function getModelTurnText(msg: LiveServerMessage): string | null {
  const parts = getModelTurnParts(msg);
  const text = parts
    .map((part) => {
      const value = (part as { text?: unknown })?.text;
      return typeof value === "string" ? value : "";
    })
    .join("")
    .trim();

  return text || null;
}

function normalizeLiveText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function getSuffixPrefixOverlap(previous: string, next: string): number {
  const maxLength = Math.min(previous.length, next.length);
  for (let length = maxLength; length > 0; length -= 1) {
    if (previous.slice(-length) === next.slice(0, length)) {
      return length;
    }
  }
  return 0;
}

function looksLikeSameReply(previous: string, next: string): boolean {
  if (!previous || !next) {
    return true;
  }

  if (
    previous === next ||
    previous.startsWith(next) ||
    next.startsWith(previous) ||
    previous.includes(next) ||
    next.includes(previous)
  ) {
    return true;
  }

  const sharedPrefixLength = (() => {
    const maxLength = Math.min(previous.length, next.length);
    let length = 0;
    while (length < maxLength && previous[length] === next[length]) {
      length += 1;
    }
    return length;
  })();

  if (sharedPrefixLength >= Math.min(24, Math.max(8, Math.floor(Math.min(previous.length, next.length) * 0.5)))) {
    return true;
  }

  return getSuffixPrefixOverlap(previous, next) >= Math.min(18, Math.max(6, Math.floor(next.length * 0.4)));
}

function mergeStreamingText(previous: string, next: string): string {
  const prev = normalizeLiveText(previous);
  const current = normalizeLiveText(next);

  if (!prev) {
    return current;
  }

  if (!current) {
    return prev;
  }

  if (prev === current || prev.includes(current)) {
    return prev;
  }

  if (current.includes(prev)) {
    return current;
  }

  const overlap = getSuffixPrefixOverlap(prev, current);
  if (overlap > 0) {
    return normalizeLiveText(`${prev}${current.slice(overlap)}`);
  }

  return normalizeLiveText(`${prev} ${current}`);
}

function isInterrupted(msg: LiveServerMessage): boolean {
  const sc = getServerContent(msg);
  return Boolean(sc?.interrupted);
}

function getTranscriptMeta(
  msg: LiveServerMessage,
  key: "inputTranscription" | "outputTranscription",
): { text: string | null; finished: boolean } {
  const sc = getServerContent(msg);
  const entry = sc?.[key] as Record<string, unknown> | undefined;
  return {
    text: typeof entry?.text === "string" && entry.text.trim() ? entry.text : null,
    finished: entry?.finished === true,
  };
}

function hasSetupComplete(msg: LiveServerMessage): boolean {
  const raw = msg as unknown as Record<string, unknown>;
  return Boolean(raw.setupComplete ?? raw.setup_complete);
}

function decodeAudioPart(part: unknown): { pcm: Int16Array; sampleRate: number } | null {
  const p = part as Record<string, unknown>;
  const inline = (p.inlineData ?? p.inline_data) as Record<string, unknown> | undefined;
  const data = inline?.data;
  if (typeof data !== "string") return null;
  const mime = String(inline?.mimeType ?? inline?.mime_type ?? "audio/pcm");
  const rateMatch = /rate=(\d+)/.exec(mime);
  const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : LIVE_OUTPUT_SAMPLE_RATE;
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  if (bytes.byteLength < 2) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = Math.floor(bytes.byteLength / 2);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = dv.getInt16(i * 2, true);
  return { pcm, sampleRate };
}

const MODEL = "gemini-3.1-flash-live-preview";

export function useGeminiLiveDocument() {
  const [status, setStatus] = useState<LiveDocStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [heardText, setHeardText] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyTurnId, setReplyTurnId] = useState(0);
  /** Bumps when the user finishes a spoken question or sends text — for clearing PDF highlights. */
  const [userInputTurnId, setUserInputTurnId] = useState(0);
  /** PDF text when a live session starts (medication export + critical steps). */
  const [documentExtractedText, setDocumentExtractedText] = useState("");
  const [phiRedactionSummary, setPhiRedactionSummary] = useState<PhiRedactionSummary[]>([]);
  const [phiRedactionTotal, setPhiRedactionTotal] = useState(0);
  const [inputMode, setInputMode] = useState<LiveInputMode>("voice");

  const sessionRef = useRef<Session | null>(null);
  const playerRef = useRef<PcmChunkPlayer | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const micMutedRef = useRef(false);
  const inputModeRef = useRef<LiveInputMode>("voice");
  const assistantReplyRef = useRef("");
  const assistantTurnCanResetRef = useRef(false);

  const resetAssistantReplyState = useCallback(() => {
    assistantReplyRef.current = "";
    assistantTurnCanResetRef.current = false;
    setReplyText("");
    setReplyTurnId(0);
    setUserInputTurnId(0);
  }, []);

  const pushAssistantReply = useCallback((incomingText: string, canResetAfterMessage: boolean) => {
    const incoming = normalizeLiveText(incomingText);
    if (!incoming) {
      if (canResetAfterMessage) {
        assistantTurnCanResetRef.current = true;
      }
      return;
    }

    const previous = assistantReplyRef.current;
    const shouldStartNewTurn =
      !previous || (assistantTurnCanResetRef.current && !looksLikeSameReply(previous, incoming));

    if (shouldStartNewTurn) {
      assistantReplyRef.current = "";
      assistantTurnCanResetRef.current = false;
      setReplyTurnId((current) => current + 1);
    }

    const mergedReply = mergeStreamingText(assistantReplyRef.current, incoming);
    assistantReplyRef.current = mergedReply;
    setReplyText(mergedReply);

    if (canResetAfterMessage) {
      assistantTurnCanResetRef.current = true;
    }
  }, []);

  const stopMicPipeline = useCallback(() => {
    try {
      micRef.current?.stop();
    } catch {
      /* ignore */
    }
    micRef.current = null;
  }, []);

  const startMicPipeline = useCallback(async () => {
    const sendAudio = (b64: string) => {
      const s = sessionRef.current;
      if (!s || micMutedRef.current || inputModeRef.current !== "voice") return;
      s.sendRealtimeInput({
        audio: { data: b64, mimeType: "audio/pcm;rate=16000" },
      });
    };
    micRef.current = await startMicPcmCapture(
      sendAudio,
      () => !micMutedRef.current && inputModeRef.current === "voice",
      () => {
        playerRef.current?.flush();
      },
    );
  }, []);

  const stopSession = useCallback(() => {
    micMutedRef.current = false;
    setMicMuted(false);
    inputModeRef.current = "voice";
    setInputMode("voice");
    stopMicPipeline();
    try {
      sessionRef.current?.close();
    } catch {
      /* ignore */
    }
    sessionRef.current = null;
    try {
      playerRef.current?.close();
    } catch {
      /* ignore */
    }
    playerRef.current = null;
    assistantReplyRef.current = "";
    assistantTurnCanResetRef.current = false;
    setStatus("idle");
    setError(null);
    setReplyText("");
    setReplyTurnId(0);
    setUserInputTurnId(0);
    setPhiRedactionSummary([]);
    setPhiRedactionTotal(0);
  }, [stopMicPipeline]);

  const startSession = useCallback(
    async (pdfUrl: string, fileName: string | null) => {
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
      if (!apiKey?.trim()) {
        setError("Missing NEXT_PUBLIC_GOOGLE_API_KEY in your environment.");
        setStatus("error");
        return;
      }

      stopSession();
      setStatus("connecting");
      setError(null);
      setHeardText("");
      resetAssistantReplyState();
      setDocumentExtractedText("");
      setPhiRedactionSummary([]);
      setPhiRedactionTotal(0);
      micMutedRef.current = false;
      setMicMuted(false);
      inputModeRef.current = "voice";
      setInputMode("voice");

      try {
        // Unlock Web Audio in the same user-gesture turn as the click. If we wait until
        // after extractPdfText / network work, browsers may keep AudioContext suspended
        // and Gemini output will be silent.
        const player = new PcmChunkPlayer(LIVE_OUTPUT_SAMPLE_RATE);
        playerRef.current = player;
        await player.resume();

        const indexPromise = buildDocumentIndexFromUrl(pdfUrl).catch(() => null as DocumentIndex | null);
        const redaction = await extractRedactedPdfText(pdfUrl);
        const text = redaction.text;
        const documentIndex = await indexPromise;
        setDocumentExtractedText(text);
        setPhiRedactionSummary(redaction.summary);
        setPhiRedactionTotal(redaction.totalRemoved);
        const weak = isWeakTextContent(text);
        let jpegBase64: string | null = null;
        if (weak) {
          try {
            jpegBase64 = await renderFirstPageJpegBase64(pdfUrl);
          } catch {
            jpegBase64 = null;
          }
        }

        const ai = new GoogleGenAI({ apiKey });

        await player.resume();
        let resolveSetup: (() => void) | null = null;
        const setupReady = new Promise<void>((resolve) => {
          resolveSetup = resolve;
        });

        const session = await ai.live.connect({
          model: MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
                endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
                prefixPaddingMs: 80,
                silenceDurationMs: 220,
              },
            },
            systemInstruction: {
              parts: [
                {
                  text: buildLiveSystemInstruction(documentIndex),
                },
              ],
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
          callbacks: {
            onopen: () => {},
            onmessage: (message: LiveServerMessage) => {
              if (hasSetupComplete(message)) {
                resolveSetup?.();
                resolveSetup = null;
              }
              const inputTranscript = getTranscriptMeta(message, "inputTranscription");
              if (inputTranscript.text) {
                setHeardText(inputTranscript.text);
              }
              if (inputTranscript.finished) {
                setUserInputTurnId((current) => current + 1);
              }
              const serverContent = getServerContent(message);
              const outputTranscript = getTranscriptMeta(message, "outputTranscription");
              const outputText =
                outputTranscript.text ?? getModelTurnText(message) ?? null;
              if (outputText) {
                pushAssistantReply(
                  outputText,
                  outputTranscript.finished ||
                    serverContent?.turnComplete === true ||
                    serverContent?.generationComplete === true,
                );
              } else if (
                outputTranscript.finished ||
                serverContent?.turnComplete === true ||
                serverContent?.generationComplete === true
              ) {
                assistantTurnCanResetRef.current = true;
              }
              if (isInterrupted(message)) {
                assistantTurnCanResetRef.current = true;
                playerRef.current?.flush();
                return;
              }
              for (const part of getModelTurnParts(message)) {
                const decoded = decodeAudioPart(part);
                if (decoded) {
                  playerRef.current?.enqueuePcm16(decoded.pcm, decoded.sampleRate);
                }
              }
            },
            onerror: (e: ErrorEvent) => {
              setError(e.message || "Live session error");
              setStatus("error");
            },
            onclose: () => {},
          },
        });

        sessionRef.current = session;

        await Promise.race([
          setupReady,
          new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
        ]);

        let seedText = "";
        if (!weak) {
          seedText =
            `The user uploaded a document${fileName ? ` (${fileName})` : ""}. ` +
            `Talk only about this document. Start by greeting the user and telling them ` +
            `you can help them talk through it.\n\n` +
            `Here is extracted document text (may be truncated):\n\n${text}`;
        } else if (jpegBase64) {
          seedText =
            `The user uploaded a document${fileName ? ` (${fileName})` : ""}. ` +
            `Little or no text could be extracted, so you were sent an image of the first page. ` +
            `Talk only about that document. Start by greeting the user and saying you can help ` +
            `them discuss what is on the page.`;
        } else {
          seedText =
            `The user uploaded a document${fileName ? ` (${fileName})` : ""}, but it could not be ` +
            `parsed. Start by greeting the user, explain that the document content was not loaded, ` +
            `and ask them what part they want help with.`;
        }

        if (jpegBase64) {
          session.sendRealtimeInput({
            video: { data: jpegBase64, mimeType: "image/jpeg" },
          });
        }
        session.sendRealtimeInput({ text: seedText });

        try {
          await startMicPipeline();
        } catch (micErr) {
          try {
            session.close();
          } catch {
            /* ignore */
          }
          sessionRef.current = null;
          try {
            playerRef.current?.close();
          } catch {
            /* ignore */
          }
          playerRef.current = null;
          throw micErr;
        }

        setStatus("live");
      } catch (err) {
        stopSession();
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus("error");
      }
    },
    [pushAssistantReply, resetAssistantReplyState, startMicPipeline, stopSession],
  );

  const sendUserText = useCallback((text: string) => {
    const s = sessionRef.current;
    const t = text.trim();
    if (!s || !t) return;
    s.sendRealtimeInput({ text: t });
    setUserInputTurnId((current) => current + 1);
  }, []);

  const setAslMode = useCallback(
    (enabled: boolean) => {
      const s = sessionRef.current;
      if (!s) return;
      if (enabled) {
        inputModeRef.current = "asl";
        setInputMode("asl");
        micMutedRef.current = true;
        setMicMuted(true);
        stopMicPipeline();
        s.sendRealtimeInput({ audioStreamEnd: true });
      } else {
        inputModeRef.current = "voice";
        setInputMode("voice");
        micMutedRef.current = false;
        setMicMuted(false);
        void startMicPipeline().catch(() => {
          /* mic permission may fail; leave voice path best-effort */
        });
      }
    },
    [stopMicPipeline, startMicPipeline],
  );

  const toggleMic = useCallback(() => {
    if (inputModeRef.current === "asl") return;
    const s = sessionRef.current;
    const next = !micMutedRef.current;
    micMutedRef.current = next;
    setMicMuted(next);
    if (next && s) {
      s.sendRealtimeInput({ audioStreamEnd: true });
    }
  }, []);

  return {
    status,
    error,
    micMuted,
    heardText,
    replyText,
    replyTurnId,
    userInputTurnId,
    documentExtractedText,
    phiRedactionSummary,
    phiRedactionTotal,
    inputMode,
    startSession,
    stopSession,
    toggleMic,
    sendUserText,
    setAslMode,
  };
}
