import type { SignalTimingEstimate } from "@/lib/types";

/**
 * GLOSA must not treat a predicted green window, or the vehicle's own
 * predicted arrival time, as exact instants. This module turns both kinds
 * of uncertainty into a simple, deterministic probability bucket the
 * optimizer can score against — no ML, just interval overlap, per the
 * spec's explicit instruction not to reach for machine learning before
 * there's enough data to justify it.
 */

export type GreenProbabilityBucket = "DEFINITELY_GREEN" | "LIKELY_GREEN" | "UNCERTAIN" | "LIKELY_RED" | "DEFINITELY_RED";

const MIN_ARRIVAL_UNCERTAINTY_SEC = 1;
const MAX_ARRIVAL_UNCERTAINTY_SEC = 20;
/** Simple conservative heuristic: uncertainty grows proportionally with how far out the prediction is. */
const ETA_UNCERTAINTY_FRACTION = 0.12;

/**
 * Conservative arrival-time uncertainty (± seconds), from ETA, GPS
 * accuracy, and current speed. Deliberately simple: the goal is "don't
 * treat a 0.5-mile-out arrival as exact", not a precise error model.
 */
export function estimateArrivalUncertaintySec(etaSec: number, gpsAccuracyM = 10, currentSpeedMps = 1): number {
  const gpsTimeUncertaintySec = gpsAccuracyM / Math.max(currentSpeedMps, 1);
  const proportional = Math.abs(etaSec) * ETA_UNCERTAINTY_FRACTION;
  return Math.min(MAX_ARRIVAL_UNCERTAINTY_SEC, Math.max(MIN_ARRIVAL_UNCERTAINTY_SEC, proportional + gpsTimeUncertaintySec));
}

/** The green window (epoch ms) this estimate implies, for whichever phase it's currently reporting. `null` if it can't be determined. */
function greenWindow(estimate: SignalTimingEstimate): { start: number; end: number } | null {
  if (estimate.phase === "GREEN") {
    // Already green: treat the window as open-ended on the near side (green now), bounded by when it's predicted to end.
    if (estimate.likelyEndTime == null) return null;
    return { start: -Infinity, end: estimate.likelyEndTime };
  }
  if (estimate.nextGreenStart == null || estimate.nextGreenEnd == null) return null;
  return { start: estimate.nextGreenStart, end: estimate.nextGreenEnd };
}

/**
 * Classifies whether an arrival at `arrivalTime` (± `arrivalUncertaintySec`)
 * falls inside the estimated green window. Uses interval overlap: if the
 * entire uncertainty interval falls inside/outside the window, that's
 * DEFINITELY_*; if most of it does, LIKELY_*; otherwise UNCERTAIN.
 */
export function classifyArrivalProbability(
  estimate: SignalTimingEstimate,
  arrivalTime: number,
  arrivalUncertaintySec: number,
): GreenProbabilityBucket {
  const window = greenWindow(estimate);
  if (!window) return "UNCERTAIN";

  const uncertaintyMs = arrivalUncertaintySec * 1000;
  const earliest = arrivalTime - uncertaintyMs;
  const latest = arrivalTime + uncertaintyMs;

  if (earliest >= window.start && latest <= window.end) return "DEFINITELY_GREEN";
  if (latest < window.start || earliest > window.end) return "DEFINITELY_RED";

  const overlapStart = Math.max(earliest, window.start);
  const overlapEnd = Math.min(latest, window.end);
  const overlapDuration = Math.max(0, overlapEnd - overlapStart);
  const totalDuration = latest - earliest;
  const overlapFraction = totalDuration > 0 ? overlapDuration / totalDuration : (arrivalTime >= window.start && arrivalTime <= window.end ? 1 : 0);

  if (overlapFraction >= 0.75) return "LIKELY_GREEN";
  if (overlapFraction <= 0.25) return "LIKELY_RED";
  return "UNCERTAIN";
}

/** Seconds of buffer between the arrival instant and the nearest edge of the green window — positive when comfortably inside, negative outside. */
export function greenMarginSec(estimate: SignalTimingEstimate, arrivalTime: number): number | null {
  const window = greenWindow(estimate);
  if (!window) return null;
  if (arrivalTime < window.start) return window.start === -Infinity ? null : (arrivalTime - window.start) / 1000;
  if (arrivalTime > window.end) return (window.end - arrivalTime) / 1000;
  const distToStart = window.start === -Infinity ? Infinity : arrivalTime - window.start;
  const distToEnd = window.end - arrivalTime;
  return Math.min(distToStart, distToEnd) / 1000;
}

const BUCKET_SCORE: Record<GreenProbabilityBucket, number> = {
  DEFINITELY_GREEN: 1,
  LIKELY_GREEN: 0.6,
  UNCERTAIN: 0,
  LIKELY_RED: -0.6,
  DEFINITELY_RED: -1,
};

/**
 * A single normalized score (~[-1, 1]) rewarding robust trajectories:
 * given two candidates that are both "definitely green", the one with a
 * wider margin (arrives comfortably mid-window, not at the very edge of
 * an exact prediction) scores higher. This is what makes the optimizer
 * prefer "reaches the middle of the green window with ±4s margin" over
 * "reaches green only if the prediction is exact ±0.5s".
 */
export function robustGreenScore(estimate: SignalTimingEstimate, arrivalTime: number, arrivalUncertaintySec: number): number {
  const bucket = classifyArrivalProbability(estimate, arrivalTime, arrivalUncertaintySec);
  const bucketScore = BUCKET_SCORE[bucket];
  const margin = greenMarginSec(estimate, arrivalTime);
  if (margin == null || !Number.isFinite(margin)) return bucketScore;
  // Deliberately not clamped back to [-1, 1]: this is a ranking score, not
  // a normalized probability, and two candidates that both land in
  // DEFINITELY_GREEN must still be distinguishable by how much margin they
  // have — a bigger buffer against a slightly-wrong prediction is better,
  // per the spec's "reaches the middle of the window with ±4s margin" example.
  const marginBonus = (Math.abs(margin) / 10) * 0.3;
  return bucketScore + (bucketScore >= 0 ? marginBonus : -marginBonus);
}
