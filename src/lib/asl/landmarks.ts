/** MediaPipe hand landmark indices (21 points). */
export const WRIST = 0;

export type Landmark = { x: number; y: number; z: number };

export function mirrorLandmarksX(landmarks: Landmark[]): Landmark[] {
  return landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
}

/**
 * Translate so wrist is origin; scale by distance wrist → middle MCP (idx 9)
 * to reduce distance / camera variance.
 */
export function normalizeLandmarks(landmarks: Landmark[]): Float32Array {
  const w = landmarks[WRIST];
  const midMcp = landmarks[9];
  const scale =
    Math.hypot(midMcp.x - w.x, midMcp.y - w.y, midMcp.z - w.z) || 1e-6;
  const out = new Float32Array(landmarks.length * 3);
  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    out[i * 3] = (p.x - w.x) / scale;
    out[i * 3 + 1] = (p.y - w.y) / scale;
    out[i * 3 + 2] = (p.z - w.z) / scale;
  }
  return out;
}

/**
 * Normalized-image span of the hand (ignores z). Tiny spans often mean a bogus
 * detection or a hand too small in frame to classify reliably.
 */
export function handBoundingSpan(landmarks: Landmark[]): { spanX: number; spanY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of landmarks) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { spanX: maxX - minX, spanY: maxY - minY };
}

export function l2Distance(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/** Softmax over negative distances (smaller distance = higher score). */
export function scoresFromDistances(distances: number[], temperature = 0.35): number[] {
  const exps = distances.map((d) => Math.exp(-d / temperature));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}
