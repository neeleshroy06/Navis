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
  extractPdfText,
  isWeakTextContent,
  renderFirstPageJpegBase64,
} from "@/lib/pdfExtract";

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

function isInterrupted(msg: LiveServerMessage): boolean {
  const sc = getServerContent(msg);
  return Boolean(sc?.interrupted);
}

function getTranscript(
  msg: LiveServerMessage,
  key: "inputTranscription" | "outputTranscription",
): string | null {
  const sc = getServerContent(msg);
  const entry = sc?.[key] as Record<string, unknown> | undefined;
  return typeof entry?.text === "string" && entry.text.trim() ? entry.text : null;
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
  const [inputMode, setInputMode] = useState<LiveInputMode>("voice");

  const sessionRef = useRef<Session | null>(null);
  const playerRef = useRef<PcmChunkPlayer | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const micMutedRef = useRef(false);
  const inputModeRef = useRef<LiveInputMode>("voice");

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
    setStatus("idle");
    setError(null);
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
      setReplyText("");
      micMutedRef.current = false;
      setMicMuted(false);
      inputModeRef.current = "voice";
      setInputMode("voice");

      try {
        const text = await extractPdfText(pdfUrl);
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

        const player = new PcmChunkPlayer(LIVE_OUTPUT_SAMPLE_RATE);
        playerRef.current = player;
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
                  text: `You are a compassionate assistant helping the user understand a document (often health-related). Answer in short, clear spoken sentences. Speak naturally, like a human-to-human conversation. Stay grounded in the document content you receive. If something is missing or unclear, ask a brief clarifying question.`,
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
              const inputText = getTranscript(message, "inputTranscription");
              if (inputText) {
                setHeardText(inputText);
              }
              const outputText = getTranscript(message, "outputTranscription") ?? message.text ?? null;
              if (outputText) {
                setReplyText(outputText);
              }
              if (isInterrupted(message)) {
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
    [stopSession, startMicPipeline],
  );

  const sendUserText = useCallback((text: string) => {
    const s = sessionRef.current;
    const t = text.trim();
    if (!s || !t) return;
    s.sendRealtimeInput({ text: t });
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
    inputMode,
    startSession,
    stopSession,
    toggleMic,
    sendUserText,
    setAslMode,
  };
}
