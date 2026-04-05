"use client";

import { Camera, CameraOff, Delete, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGeminiLiveDocumentContext } from "@/components/GeminiLiveDocumentProvider";
import {
  BUILTIN_THRESHOLDS,
  classifyLetter,
  classifyNormalizedLandmarks,
  PERSONALIZED_THRESHOLDS,
  passesDisplayThresholds,
  type TemplateMap,
} from "@/lib/asl/classifyLetter";
import {
  handBoundingSpan,
  mirrorLandmarksX,
  normalizeLandmarks,
  type Landmark,
} from "@/lib/asl/landmarks";

/** Collect per-frame guesses for this long, then commit the most common letter (no steadiness required). */
const CAPTURE_WINDOW_MS = 1000;
/** Minimum gap after a commit before the next capture window can start. */
const GAP_MS = 350;
const INFERENCE_EVERY_MS = 50;
const MIN_HAND_SPAN = 0.045;
const CALIBRATION_PATHS = [
  "/asl/asl-calibration (1).json",
  "/asl/asl-calibration.json",
  "/asl/default-calibration.json",
] as const;
/** No hand in frame for this long → insert a space (once per gap). */
const IDLE_SPACE_MS = 1000;
/** No hand in frame for this long → send message to Gemini. */
const IDLE_SEND_MS = 2000;

type HandConnection = { start: number; end: number };
type CalibrationEntry = { count: number; vector: number[] };
type CalibrationMap = Record<string, CalibrationEntry>;

function toCalibrationTemplates(calibration: CalibrationMap): TemplateMap {
  return Object.fromEntries(
    Object.entries(calibration).map(([letter, entry]) => [letter, Float32Array.from(entry.vector)]),
  );
}

function drawHandOverlay(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement | null,
  landmarks: Array<{ x: number; y: number }> | null,
  connections: readonly HandConnection[],
) {
  if (!canvas || !video) return;
  const w = video.clientWidth;
  const h = video.clientHeight;
  if (w < 2 || h < 2) return;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (!landmarks || landmarks.length < 21 || connections.length === 0) return;
  ctx.strokeStyle = "rgba(34, 211, 238, 0.92)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (const c of connections) {
    const a = landmarks[c.start];
    const b = landmarks[c.end];
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  for (const p of landmarks) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 3.2, 0, 2 * Math.PI);
    ctx.fill();
  }
}

async function loadCheckedInCalibration(): Promise<CalibrationMap> {
  for (const path of CALIBRATION_PATHS) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) continue;
      return (await response.json()) as CalibrationMap;
    } catch {
      // try next
    }
  }
  return {};
}

function pickPluralityLetter(votes: Map<string, number>): string | null {
  let best = 0;
  let bestLetter: string | null = null;
  for (const [letter, count] of votes) {
    if (count > best || (count === best && letter < (bestLetter ?? "Z"))) {
      best = count;
      bestLetter = letter;
    }
  }
  return bestLetter;
}

export function AslFingerspellingPanel() {
  const { status, inputMode, setAslMode, sendUserText } = useGeminiLiveDocumentContext();
  const live = status === "live";
  const aslOn = inputMode === "asl";

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<import("@mediapipe/tasks-vision").HandLandmarker | null>(null);
  const handConnectionsRef = useRef<readonly HandConnection[]>([]);
  const rafRef = useRef<number>(0);
  const lastInferRef = useRef(0);
  const lastObservedRef = useRef<{ normalized: Float32Array } | null>(null);
  const calibrationTemplatesRef = useRef<TemplateMap>({});

  const [guess, setGuess] = useState<{
    letter: string;
    confidence: number;
    uncertain: boolean;
    mode: "generic" | "personalized";
  } | null>(null);
  const [buffer, setBuffer] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [handVisible, setHandVisible] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationMap>({});

  const bufferRef = useRef("");
  const lastCommitAtRef = useRef(0);
  /** Start time of current 1s plurality capture window; null when idle. */
  const captureWindowStartRef = useRef<number | null>(null);
  const voteBucketsRef = useRef<Map<string, number>>(new Map());
  /** When hand last left the frame (no landmarks); null while hand is visible. */
  const handMissingSinceRef = useRef<number | null>(null);
  /** After a letter commit, allow at most one auto-space before the next letter. */
  const spaceAllowedAfterLetterRef = useRef(true);

  const stopCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    lastObservedRef.current = null;
    handMissingSinceRef.current = null;
    captureWindowStartRef.current = null;
    voteBucketsRef.current = new Map();
    setHandVisible(false);
    void landmarkerRef.current?.close();
    landmarkerRef.current = null;
  }, []);

  useEffect(() => {
    bufferRef.current = buffer;
  }, [buffer]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const merged = await loadCheckedInCalibration();
        if (!cancelled) {
          setCalibration(merged);
        }
      } catch {
        if (!cancelled) setCalibration({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    calibrationTemplatesRef.current = toCalibrationTemplates(calibration);
  }, [calibration]);

  const sendUserTextRef = useRef(sendUserText);
  sendUserTextRef.current = sendUserText;

  const loop = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    const now = performance.now();
    if (now - lastInferRef.current < INFERENCE_EVERY_MS) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    lastInferRef.current = now;

    const result = landmarker.detectForVideo(video, now);
    const lm = result.landmarks?.[0];

    const processHandAbsent = () => {
      if (handMissingSinceRef.current === null) handMissingSinceRef.current = now;
      const d = now - handMissingSinceRef.current;
      const buf = bufferRef.current;
      if (d >= IDLE_SEND_MS && buf.trim()) {
        const raw = buf.trimEnd();
        const lower = raw.toLowerCase();
        const sentence = lower.length ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
        sendUserTextRef.current(sentence);
        setBuffer("");
        bufferRef.current = "";
        handMissingSinceRef.current = null;
      }
    };

    if (!lm || lm.length < 21) {
      drawHandOverlay(canvasRef.current, video, null, handConnectionsRef.current);
      lastObservedRef.current = null;
      setHandVisible(false);
      setGuess(null);
      captureWindowStartRef.current = null;
      voteBucketsRef.current = new Map();
      processHandAbsent();
      rafRef.current = requestAnimationFrame(loop);
      return;
    }

    drawHandOverlay(canvasRef.current, video, lm, handConnectionsRef.current);

    const landmarks: Landmark[] = lm.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    const handedness = result.handedness?.[0]?.[0]?.categoryName?.toLowerCase();
    const canonicalLandmarks = handedness === "left" ? mirrorLandmarksX(landmarks) : landmarks;
    const { spanX, spanY } = handBoundingSpan(canonicalLandmarks);
    if (spanX < MIN_HAND_SPAN || spanY < MIN_HAND_SPAN) {
      lastObservedRef.current = null;
      setHandVisible(false);
      setGuess(null);
      captureWindowStartRef.current = null;
      voteBucketsRef.current = new Map();
      processHandAbsent();
      rafRef.current = requestAnimationFrame(loop);
      return;
    }

    if (handMissingSinceRef.current !== null) {
      const gap = now - handMissingSinceRef.current;
      handMissingSinceRef.current = null;
      if (
        gap >= IDLE_SPACE_MS &&
        gap < IDLE_SEND_MS &&
        spaceAllowedAfterLetterRef.current &&
        bufferRef.current.length > 0
      ) {
        const last = bufferRef.current.slice(-1);
        if (/[A-Z]/.test(last)) {
          setBuffer((b) => b + " ");
          spaceAllowedAfterLetterRef.current = false;
        }
      }
    }

    const normalized = normalizeLandmarks(canonicalLandmarks);
    lastObservedRef.current = { normalized };
    setHandVisible(true);

    const customTemplates = calibrationTemplatesRef.current;
    const usePersonalized = Object.keys(customTemplates).length >= 2;
    const cls = usePersonalized
      ? classifyNormalizedLandmarks(normalized, customTemplates)
      : classifyLetter(canonicalLandmarks);

    const tryFinalizeCapture = () => {
      if (captureWindowStartRef.current === null) return;
      if (now - captureWindowStartRef.current < CAPTURE_WINDOW_MS) return;
      const votes = voteBucketsRef.current;
      const winner = pickPluralityLetter(votes);
      if (winner) {
        lastCommitAtRef.current = now;
        spaceAllowedAfterLetterRef.current = true;
        setBuffer((b) => b + winner);
      }
      captureWindowStartRef.current = null;
      voteBucketsRef.current = new Map();
    };

    if (!cls) {
      setGuess(null);
      handMissingSinceRef.current = null;
      tryFinalizeCapture();
      rafRef.current = requestAnimationFrame(loop);
      return;
    }

    const thresholds = usePersonalized ? PERSONALIZED_THRESHOLDS : BUILTIN_THRESHOLDS;
    const displayOk = passesDisplayThresholds(cls, thresholds);
    setGuess({
      letter: cls.letter,
      confidence: cls.confidence,
      uncertain: !displayOk,
      mode: usePersonalized ? "personalized" : "generic",
    });

    const L = cls.letter;
    if (now - lastCommitAtRef.current >= GAP_MS) {
      if (captureWindowStartRef.current === null) {
        captureWindowStartRef.current = now;
        voteBucketsRef.current = new Map();
      }
      const bucket = voteBucketsRef.current;
      bucket.set(L, (bucket.get(L) ?? 0) + 1);
    }
    tryFinalizeCapture();

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  useEffect(() => {
    if (!aslOn || !live) {
      stopCamera();
      return;
    }

    let cancelled = false;
    void (async () => {
      setCameraError(null);
      try {
        const tf = await import("@tensorflow/tfjs");
        await tf.ready();
        const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
        handConnectionsRef.current = HandLandmarker.HAND_CONNECTIONS;
        const wasm = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
        );
        const handLandmarker = await HandLandmarker.createFromOptions(wasm, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (cancelled) {
          void handLandmarker.close();
          return;
        }
        landmarkerRef.current = handLandmarker;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          void handLandmarker.close();
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play();
        }
        rafRef.current = requestAnimationFrame(loop);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setCameraError(msg);
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [aslOn, live, loop, stopCamera]);

  const toggleAsl = () => {
    if (!live) return;
    setAslMode(!aslOn);
    if (aslOn) {
      setBuffer("");
      bufferRef.current = "";
      setGuess(null);
      handMissingSinceRef.current = null;
      spaceAllowedAfterLetterRef.current = true;
      captureWindowStartRef.current = null;
      voteBucketsRef.current = new Map();
      lastCommitAtRef.current = 0;
    }
  };

  const sendBuffer = () => {
    const raw = buffer.trim();
    if (!raw) return;
    const lower = raw.toLowerCase();
    const word = lower.length ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    sendUserText(word);
    setBuffer("");
    bufferRef.current = "";
    handMissingSinceRef.current = null;
    captureWindowStartRef.current = null;
    voteBucketsRef.current = new Map();
    lastCommitAtRef.current = 0;
  };

  const clearBuffer = () => {
    setBuffer("");
    bufferRef.current = "";
    handMissingSinceRef.current = null;
    captureWindowStartRef.current = null;
    voteBucketsRef.current = new Map();
    lastCommitAtRef.current = 0;
  };
  const backspace = () => setBuffer((b) => b.slice(0, -1));

  const templateCount = Object.keys(calibration).length;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--recast-border)]/60 bg-[var(--recast-surface-elevated)]/50 p-3">
      <button
        type="button"
        disabled={!live}
        onClick={toggleAsl}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--recast-border)] bg-[var(--recast-surface-elevated)]/90 px-4 py-3 text-sm font-medium text-[var(--recast-text)] shadow-sm transition hover:border-[var(--recast-accent)] hover:text-[var(--recast-accent)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {aslOn ? (
          <CameraOff className="h-4 w-4 shrink-0" strokeWidth={2} />
        ) : (
          <Camera className="h-4 w-4 shrink-0" strokeWidth={2} />
        )}
        {aslOn ? "Stop ASL mode" : "ASL mode (uses camera)"}
      </button>

      {!live ? (
        <p className="text-xs text-[var(--recast-text-muted)]">
          Start &ldquo;Talk about this document&rdquo; first, then enable ASL. Microphone turns off while
          ASL is on.
        </p>
      ) : null}

      {aslOn ? (
        <div className="flex flex-col gap-2">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-[var(--recast-border)]/50 bg-black/40">
            <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
            <canvas
              ref={canvasRef}
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden
            />
            {!cameraError ? (
              <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/90">
                Cyan = hand · palm toward camera · ~1s per letter (plurality)
              </span>
            ) : null}
          </div>
          {cameraError ? (
            <p className="text-xs text-red-600 dark:text-red-400">{cameraError}</p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--recast-text-muted)]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[var(--recast-text)]">Guess:</span>
              {guess ? (
                <span className={guess.uncertain ? "text-[var(--recast-text-muted)]" : ""}>
                  {guess.letter}{" "}
                  <span className="tabular-nums">({(guess.confidence * 100).toFixed(0)}%)</span>
                  {guess.uncertain ? (
                    <span className="ml-1 text-[var(--recast-text-muted)]">· noisy frame</span>
                  ) : null}
                  <span className="ml-1 text-[var(--recast-text-muted)]">
                    · {guess.mode === "personalized" ? "personalized JSON" : "generic model"}
                  </span>
                </span>
              ) : (
                <span>Show a clear letter</span>
              )}
            </div>
            <span>
              {templateCount >= 2
                ? `Personalized templates (${templateCount} letters)`
                : "Using generic letter shapes — add public/asl/*.json with 2+ letters for personalization"}
            </span>
          </div>

          <p className="text-[10px] leading-relaxed text-[var(--recast-text-muted)]">
            Space: lower your hand so it leaves the frame for 1–2s, then sign the next word (return before 2s
            of silence). Send: keep your hand out of frame for 2s — the line is sent to Gemini automatically.
            Use &ldquo;Send now&rdquo; if you need to send without waiting.
          </p>

          <div className="min-h-[2rem] rounded-lg border border-[var(--recast-border)]/40 bg-[var(--recast-surface)]/80 px-2 py-2 font-mono text-sm text-[var(--recast-text)]">
            {buffer || "—"}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={backspace}
              disabled={!buffer}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--recast-border)] px-3 py-2 text-xs font-medium text-[var(--recast-text)] disabled:opacity-40"
            >
              <Delete className="h-3.5 w-3.5" />
              Backspace
            </button>
            <button
              type="button"
              onClick={clearBuffer}
              disabled={!buffer}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--recast-border)] px-3 py-2 text-xs font-medium text-[var(--recast-text)] disabled:opacity-40"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={sendBuffer}
              disabled={!buffer.trim()}
              className="inline-flex flex-[2] min-w-[120px] items-center justify-center gap-2 rounded-lg border border-[var(--recast-accent)] bg-[var(--recast-accent)]/15 px-3 py-2 text-xs font-medium text-[var(--recast-accent)] disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
              Send now
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
