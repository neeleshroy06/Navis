/**
 * Procedural ideal hand landmarks (21 x 3) in normalized "hand space"
 * (wrist at origin, scale arbitrary). Used only for nearest-neighbor
 * matching — tuned for static ASL fingerspelling poses (J/Z motion not modeled).
 */

import { normalizeLandmarks, type Landmark } from "./landmarks";

const PI = Math.PI;

type Vec2 = { x: number; y: number };

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

function rot(v: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function norm(v: Vec2): Vec2 {
  const m = Math.hypot(v.x, v.y) || 1e-9;
  return { x: v.x / m, y: v.y / m };
}

/** Segment lengths (relative units) — thumb has 4 segments, others 3. */
const T_SEG = [0.06, 0.055, 0.048, 0.04];
const F_SEG = [0.045, 0.038, 0.028];

/** MCP anchor positions (right hand, palm facing camera, y grows downward). */
const MCP = {
  thumb: { x: -0.1, y: -0.02 },
  index: { x: -0.08, y: -0.1 },
  middle: { x: 0, y: -0.11 },
  ring: { x: 0.08, y: -0.1 },
  pinky: { x: 0.14, y: -0.08 },
};

/** Base direction from MCP toward fingertip when finger is extended "up" on screen. */
const DIR = {
  thumb: rot({ x: -1, y: -0.2 }, -0.35),
  index: { x: 0, y: -1 },
  middle: { x: 0, y: -1 },
  ring: { x: 0.05, y: -1 },
  pinky: { x: 0.1, y: -1 },
};

type FingerName = "thumb" | "index" | "middle" | "ring" | "pinky";

function fingerChain(
  mcp: Vec2,
  baseDir: Vec2,
  segLens: number[],
  /** bend at each joint in radians: 0 = straight, positive = flex "in" */
  bends: number[],
): Vec2[] {
  const pts: Vec2[] = [mcp];
  let dir = norm(baseDir);
  let p = { ...mcp };
  for (let i = 0; i < segLens.length; i++) {
    const bl = bends[i] ?? 0;
    dir = rot(dir, bl);
    p = add(p, scale(dir, segLens[i]));
    pts.push(p);
  }
  return pts;
}

function thumbChain(
  bends: [number, number, number, number],
  spread = 0,
): Vec2[] {
  const base = rot(MCP.thumb, spread);
  const d0 = rot(DIR.thumb, spread);
  return fingerChain(base, d0, T_SEG, bends);
}

function digitChain(
  finger: Exclude<FingerName, "thumb">,
  bends: [number, number, number],
  spread = 0,
): Vec2[] {
  const mcp = MCP[finger];
  const d0 = rot(DIR[finger], spread);
  return fingerChain(mcp, d0, F_SEG, bends);
}

function flat21From2D(points: Vec2[]): Float32Array {
  const out = new Float32Array(21 * 3);
  for (let i = 0; i < points.length; i++) {
    out[i * 3] = points[i].x;
    out[i * 3 + 1] = points[i].y;
    out[i * 3 + 2] = 0;
  }
  return out;
}

/**
 * Build 21 landmarks (flattened xyz) for a letter. Angles are heuristic
 * approximations of static ASL manual alphabet poses.
 */
export function idealLandmarksForLetter(letter: string): Float32Array {
  const L = letter.toUpperCase();
  const pts: Vec2[] = new Array(21).fill(null).map(() => ({ x: 0, y: 0 }));
  pts[0] = { x: 0, y: 0 };

  const setThumb = (b: [number, number, number, number], sp = 0) => {
    const ch = thumbChain(
      [b[0] * PI * 0.45, b[1] * PI * 0.5, b[2] * PI * 0.45, b[3] * PI * 0.35],
      sp,
    );
    pts[1] = ch[0];
    pts[2] = ch[1];
    pts[3] = ch[2];
    pts[4] = ch[ch.length - 1];
  };
  const setIdx = (b: [number, number, number], sp = 0) => {
    const ch = digitChain("index", [b[0] * PI * 0.55, b[1] * PI * 0.55, b[2] * PI * 0.45], sp);
    for (let i = 0; i < 4; i++) pts[5 + i] = ch[i];
  };
  const setMid = (b: [number, number, number], sp = 0) => {
    const ch = digitChain("middle", [b[0] * PI * 0.55, b[1] * PI * 0.55, b[2] * PI * 0.45], sp);
    for (let i = 0; i < 4; i++) pts[9 + i] = ch[i];
  };
  const setRing = (b: [number, number, number], sp = 0) => {
    const ch = digitChain("ring", [b[0] * PI * 0.55, b[1] * PI * 0.55, b[2] * PI * 0.45], sp);
    for (let i = 0; i < 4; i++) pts[13 + i] = ch[i];
  };
  const setPinky = (b: [number, number, number], sp = 0) => {
    const ch = digitChain("pinky", [b[0] * PI * 0.55, b[1] * PI * 0.55, b[2] * PI * 0.45], sp);
    for (let i = 0; i < 4; i++) pts[17 + i] = ch[i];
  };

  switch (L) {
    case "A": {
      setThumb([0.9, 0.85, 0.7, 0.3], 0);
      setIdx([0.95, 0.95, 0.85], 0);
      setMid([0.95, 0.95, 0.85], 0);
      setRing([0.95, 0.95, 0.85], 0);
      setPinky([0.95, 0.95, 0.85], 0);
      break;
    }
    case "B": {
      setThumb([0.2, 0.5, 0.4, 0.2], 0.25);
      setIdx([0.05, 0.02, 0.02], 0);
      setMid([0.05, 0.02, 0.02], 0);
      setRing([0.05, 0.02, 0.02], 0);
      setPinky([0.05, 0.02, 0.02], 0);
      break;
    }
    case "C": {
      setThumb([0.35, 0.4, 0.35, 0.25], -0.2);
      setIdx([0.35, 0.25, 0.2], -0.05);
      setMid([0.35, 0.25, 0.2], 0);
      setRing([0.35, 0.25, 0.2], 0.05);
      setPinky([0.35, 0.25, 0.2], 0.1);
      break;
    }
    case "D": {
      setThumb([0.5, 0.55, 0.45, 0.35], 0.15);
      setIdx([0.05, 0.05, 0.05], 0);
      setMid([0.85, 0.85, 0.75], 0);
      setRing([0.85, 0.85, 0.75], 0);
      setPinky([0.85, 0.85, 0.75], 0);
      break;
    }
    case "E": {
      setThumb([0.6, 0.55, 0.45, 0.35], 0);
      setIdx([0.92, 0.92, 0.85], 0);
      setMid([0.92, 0.92, 0.85], 0);
      setRing([0.92, 0.92, 0.85], 0);
      setPinky([0.92, 0.92, 0.85], 0);
      break;
    }
    case "F": {
      setThumb([0.25, 0.35, 0.3, 0.25], 0.2);
      setIdx([0.15, 0.1, 0.08], 0);
      setMid([0.05, 0.02, 0.02], 0);
      setRing([0.05, 0.02, 0.02], 0);
      setPinky([0.05, 0.02, 0.02], 0);
      break;
    }
    case "G": {
      setThumb([0.45, 0.5, 0.4, 0.3], 0);
      setIdx([0.15, 0.12, 0.1], -0.4);
      setMid([0.85, 0.85, 0.75], 0);
      setRing([0.85, 0.85, 0.75], 0);
      setPinky([0.85, 0.85, 0.75], 0);
      break;
    }
    case "H": {
      setThumb([0.35, 0.45, 0.35, 0.25], 0.1);
      setIdx([0.12, 0.08, 0.06], -0.35);
      setMid([0.12, 0.08, 0.06], 0.35);
      setRing([0.75, 0.75, 0.65], 0);
      setPinky([0.75, 0.75, 0.65], 0);
      break;
    }
    case "I": {
      setThumb([0.55, 0.5, 0.4, 0.3], 0.2);
      setIdx([0.85, 0.85, 0.75], 0);
      setMid([0.85, 0.85, 0.75], 0);
      setRing([0.85, 0.85, 0.75], 0);
      setPinky([0.05, 0.02, 0.02], 0);
      break;
    }
    case "J": {
      setThumb([0.5, 0.5, 0.4, 0.3], 0.15);
      setIdx([0.85, 0.85, 0.75], 0);
      setMid([0.85, 0.85, 0.75], 0);
      setRing([0.85, 0.85, 0.75], 0);
      setPinky([0.08, 0.05, 0.04], 0);
      break;
    }
    case "K": {
      setThumb([0.4, 0.45, 0.38, 0.28], 0.1);
      setIdx([0.1, 0.08, 0.06], -0.2);
      setMid([0.1, 0.08, 0.06], 0.2);
      setRing([0.8, 0.8, 0.7], 0);
      setPinky([0.8, 0.8, 0.7], 0);
      break;
    }
    case "L": {
      setThumb([0.15, 0.25, 0.2, 0.15], 0.35);
      setIdx([0.05, 0.03, 0.02], 0);
      setMid([0.85, 0.85, 0.75], 0);
      setRing([0.85, 0.85, 0.75], 0);
      setPinky([0.85, 0.85, 0.75], 0);
      break;
    }
    case "M": {
      setThumb([0.35, 0.4, 0.35, 0.25], 0.15);
      setIdx([0.88, 0.88, 0.8], 0);
      setMid([0.88, 0.88, 0.8], 0);
      setRing([0.88, 0.88, 0.8], 0);
      setPinky([0.88, 0.88, 0.8], 0);
      break;
    }
    case "N": {
      setThumb([0.35, 0.4, 0.35, 0.25], 0.12);
      setIdx([0.88, 0.88, 0.8], 0);
      setMid([0.88, 0.88, 0.8], 0);
      setRing([0.88, 0.88, 0.8], 0);
      setPinky([0.75, 0.75, 0.65], 0);
      break;
    }
    case "O": {
      setThumb([0.35, 0.35, 0.3, 0.25], -0.15);
      setIdx([0.45, 0.35, 0.28], -0.05);
      setMid([0.45, 0.35, 0.28], 0);
      setRing([0.45, 0.35, 0.28], 0.05);
      setPinky([0.45, 0.35, 0.28], 0.1);
      break;
    }
    case "P": {
      setThumb([0.3, 0.35, 0.3, 0.22], 0);
      setIdx([0.1, 0.08, 0.06], -0.25);
      setMid([0.75, 0.75, 0.65], 0);
      setRing([0.85, 0.85, 0.75], 0);
      setPinky([0.85, 0.85, 0.75], 0);
      break;
    }
    case "Q": {
      setThumb([0.35, 0.4, 0.35, 0.28], -0.1);
      setIdx([0.2, 0.15, 0.12], -0.35);
      setMid([0.8, 0.8, 0.7], 0);
      setRing([0.85, 0.85, 0.75], 0);
      setPinky([0.85, 0.85, 0.75], 0);
      break;
    }
    case "R": {
      setThumb([0.35, 0.4, 0.35, 0.25], 0.1);
      setIdx([0.12, 0.1, 0.08], -0.15);
      setMid([0.12, 0.1, 0.08], 0.12);
      setRing([0.8, 0.8, 0.7], 0);
      setPinky([0.8, 0.8, 0.7], 0);
      break;
    }
    case "S": {
      setThumb([0.75, 0.7, 0.55, 0.35], 0);
      setIdx([0.9, 0.9, 0.82], 0);
      setMid([0.9, 0.9, 0.82], 0);
      setRing([0.9, 0.9, 0.82], 0);
      setPinky([0.9, 0.9, 0.82], 0);
      break;
    }
    case "T": {
      setThumb([0.55, 0.5, 0.4, 0.3], 0);
      setIdx([0.9, 0.9, 0.82], 0);
      setMid([0.9, 0.9, 0.82], 0);
      setRing([0.9, 0.9, 0.82], 0);
      setPinky([0.9, 0.9, 0.82], 0);
      break;
    }
    case "U": {
      setThumb([0.4, 0.45, 0.38, 0.28], 0.15);
      setIdx([0.08, 0.05, 0.04], 0);
      setMid([0.08, 0.05, 0.04], 0);
      setRing([0.85, 0.85, 0.75], 0);
      setPinky([0.85, 0.85, 0.75], 0);
      break;
    }
    case "V": {
      setThumb([0.35, 0.4, 0.35, 0.25], 0.12);
      setIdx([0.1, 0.08, 0.06], -0.22);
      setMid([0.1, 0.08, 0.06], 0.22);
      setRing([0.82, 0.82, 0.72], 0);
      setPinky([0.82, 0.82, 0.72], 0);
      break;
    }
    case "W": {
      setThumb([0.35, 0.4, 0.35, 0.25], 0.12);
      setIdx([0.08, 0.05, 0.04], -0.12);
      setMid([0.08, 0.05, 0.04], 0);
      setRing([0.08, 0.05, 0.04], 0.12);
      setPinky([0.82, 0.82, 0.72], 0);
      break;
    }
    case "X": {
      setThumb([0.45, 0.45, 0.38, 0.28], 0.1);
      setIdx([0.55, 0.45, 0.35], 0);
      setMid([0.85, 0.85, 0.75], 0);
      setRing([0.85, 0.85, 0.75], 0);
      setPinky([0.85, 0.85, 0.75], 0);
      break;
    }
    case "Y": {
      setThumb([0.15, 0.2, 0.15, 0.12], 0.35);
      setIdx([0.85, 0.85, 0.75], 0);
      setMid([0.85, 0.85, 0.75], 0);
      setRing([0.85, 0.85, 0.75], 0);
      setPinky([0.08, 0.05, 0.04], 0);
      break;
    }
    case "Z": {
      setThumb([0.45, 0.45, 0.38, 0.28], 0.1);
      setIdx([0.12, 0.1, 0.08], -0.15);
      setMid([0.85, 0.85, 0.75], 0);
      setRing([0.85, 0.85, 0.75], 0);
      setPinky([0.85, 0.85, 0.75], 0);
      break;
    }
    default: {
      setThumb([0.35, 0.4, 0.35, 0.25], 0.1);
      setIdx([0.2, 0.15, 0.12], 0);
      setMid([0.2, 0.15, 0.12], 0);
      setRing([0.2, 0.15, 0.12], 0);
      setPinky([0.2, 0.15, 0.12], 0);
    }
  }

  return flat21From2D(pts);
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const idealCache = new Map<string, Float32Array>();

/** Precomputed normalized ideal vectors (same normalization as live frames). */
export function getIdealNormalized(letter: string): Float32Array {
  const L = letter.toUpperCase();
  if (idealCache.has(L)) return idealCache.get(L)!;
  const raw = idealLandmarksForLetter(L);
  const lm: Landmark[] = [];
  for (let i = 0; i < 21; i++) {
    lm.push({ x: raw[i * 3], y: raw[i * 3 + 1], z: raw[i * 3 + 2] });
  }
  const norm = normalizeLandmarks(lm);
  idealCache.set(L, norm);
  return norm;
}

export function getAllLetterKeys(): string[] {
  return LETTERS.split("");
}
