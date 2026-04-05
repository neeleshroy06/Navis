import * as tf from "@tensorflow/tfjs";
import { getAllLetterKeys, getIdealNormalized } from "./handBuilder";
import { l2Distance, normalizeLandmarks, type Landmark } from "./landmarks";

const LETTERS = getAllLetterKeys();

/** With many classes, the top softmax score is naturally modest. */
const SOFTMAX_TEMPERATURE = 0.5;

export type ThresholdTier = {
  minSoftmax: number;
  minDistanceMargin: number;
  maxBestL2: number;
};

export type ThresholdSet = {
  display: ThresholdTier;
  commit: ThresholdTier;
};

/**
 * Generic procedural templates are noisy, so we keep them looser.
 * User-calibrated templates are much tighter.
 */
export const BUILTIN_THRESHOLDS: ThresholdSet = {
  display: {
    minSoftmax: 0.052,
    minDistanceMargin: 0.018,
    maxBestL2: 1.62,
  },
  commit: {
    minSoftmax: 0.065,
    minDistanceMargin: 0.026,
    maxBestL2: 1.46,
  },
};

export const PERSONALIZED_THRESHOLDS: ThresholdSet = {
  display: {
    minSoftmax: 0.09,
    minDistanceMargin: 0.035,
    maxBestL2: 0.72,
  },
  commit: {
    minSoftmax: 0.12,
    minDistanceMargin: 0.05,
    maxBestL2: 0.58,
  },
};

export type LetterClassification = {
  letter: string;
  /** Softmax mass on the winning letter (not calibrated probability). */
  confidence: number;
  /** L2 distance to the closest procedural template (lower = better). */
  bestDistance: number;
  /** L2 gap between 1st and 2nd best templates (larger = less ambiguous). */
  distanceMargin: number;
  distances: { letter: string; distance: number }[];
};

export type TemplateMap = Record<string, Float32Array>;
const builtinTemplates: TemplateMap = Object.fromEntries(
  LETTERS.map((letter) => [letter, getIdealNormalized(letter)]),
);

export function passesDisplayThresholds(
  c: LetterClassification,
  thresholds: ThresholdSet = BUILTIN_THRESHOLDS,
): boolean {
  const { minSoftmax, minDistanceMargin, maxBestL2 } = thresholds.display;
  return (
    c.confidence >= minSoftmax &&
    c.distanceMargin >= minDistanceMargin &&
    c.bestDistance <= maxBestL2
  );
}

export function passesCommitThresholds(
  c: LetterClassification,
  thresholds: ThresholdSet = BUILTIN_THRESHOLDS,
): boolean {
  const { minSoftmax, minDistanceMargin, maxBestL2 } = thresholds.commit;
  return (
    c.confidence >= minSoftmax &&
    c.distanceMargin >= minDistanceMargin &&
    c.bestDistance <= maxBestL2
  );
}

export function classifyNormalizedLandmarks(
  user: Float32Array,
  templates: TemplateMap,
): LetterClassification | null {
  const entries = Object.entries(templates);
  if (!entries.length) return null;
  const distances = entries.map(([_, template]) => l2Distance(user, template));
  const scores = tf.tidy(() => {
    const d = tf.tensor1d(distances);
    return tf.softmax(tf.neg(tf.div(d, tf.scalar(SOFTMAX_TEMPERATURE)))).dataSync();
  });
  let bestIdx = 0;
  let best = distances[0];
  for (let i = 1; i < distances.length; i++) {
    if (distances[i] < best) {
      best = distances[i];
      bestIdx = i;
    }
  }
  const ranked = entries
    .map(([letter], i) => ({ letter, distance: distances[i] }))
    .sort((a, b) => a.distance - b.distance);
  const runnerUpDist = ranked[1]?.distance ?? Infinity;
  return {
    letter: entries[bestIdx][0],
    confidence: scores[bestIdx],
    bestDistance: best,
    distanceMargin: runnerUpDist - best,
    distances: ranked.slice(0, 8),
  };
}

/**
 * Nearest-neighbor over normalized 63-d landmark vectors vs procedural ideals.
 * J and Z are static approximations only (true ASL uses motion).
 */
export function classifyLetter(landmarks: Landmark[]): LetterClassification | null {
  if (!landmarks || landmarks.length < 21) return null;
  return classifyNormalizedLandmarks(normalizeLandmarks(landmarks), builtinTemplates);
}
