import type { ControlTypeClassification, DriveObservation, LearnedTimingModel } from "@/lib/types";

/**
 * Conservative, non-ML timing inference from passive/manual real-drive
 * observations. This intentionally does NOT try to be a full phase model
 * from day one — it only asserts what the evidence actually supports:
 *
 *   1. "Green-start" anchors (GREEN_START_MANUAL, and — more weakly —
 *      DEPART_SIGNAL) are clustered across a range of plausible cycle
 *      lengths using circular statistics. If they line up tightly around
 *      one candidate cycle, we accept a cycleSec + offsetSec estimate.
 *      Otherwise: no model (never guess a cycle length).
 *
 *   2. redSec is estimated ONLY from directly observed (STOP_AT_SIGNAL ->
 *      next green) wait times — never assumed. Without at least two such
 *      pairs, we do not have enough evidence to split green/red within the
 *      cycle, so no full SignalPlan is produced (a plain "we don't know
 *      the phases yet" beats a fabricated 90/30 split).
 *
 *   3. yellowSec uses a small fixed constant (3s) as a documented
 *      simplifying assumption — passive observations cannot distinguish
 *      yellow from the end of green or the start of red.
 */

const MIN_ANCHORS = 3;
const CANDIDATE_CYCLES_SEC = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120, 130, 140, 150];
const MIN_RESULTANT_LENGTH = 0.85; // circular concentration required to accept a cycle (1 = perfectly periodic)
const ASSUMED_YELLOW_SEC = 3;
const MIN_RED_SAMPLE_PAIRS = 2;
const MAX_PLAUSIBLE_WAIT_SEC = 180;
const LEARNED_CONFIDENCE_CEILING = 0.75; // inferred models never look as authoritative as a manual/verified plan

type WeightedAnchor = { phaseSec: number; weight: number; timestamp: number };

function circularFit(anchors: WeightedAnchor[], cycleSec: number): { meanPhaseSec: number; resultantLength: number } {
  let sumSin = 0;
  let sumCos = 0;
  let totalWeight = 0;
  for (const a of anchors) {
    const theta = (2 * Math.PI * (a.phaseSec % cycleSec)) / cycleSec;
    sumSin += Math.sin(theta) * a.weight;
    sumCos += Math.cos(theta) * a.weight;
    totalWeight += a.weight;
  }
  if (totalWeight === 0) return { meanPhaseSec: 0, resultantLength: 0 };
  const meanSin = sumSin / totalWeight;
  const meanCos = sumCos / totalWeight;
  const resultantLength = Math.sqrt(meanSin ** 2 + meanCos ** 2);
  const meanTheta = Math.atan2(meanSin, meanCos);
  const meanPhaseSec = (((meanTheta / (2 * Math.PI)) * cycleSec) % cycleSec + cycleSec) % cycleSec;
  return { meanPhaseSec, resultantLength };
}

function extractAnchors(observations: DriveObservation[]): WeightedAnchor[] {
  return observations
    .filter((o) => o.type === "GREEN_START_MANUAL" || o.type === "DEPART_SIGNAL")
    .map((o) => ({ phaseSec: o.timestamp / 1000, weight: o.confidence, timestamp: o.timestamp }));
}

/**
 * Finds the candidate cycle length the anchors cluster most tightly
 * around. Shared by `inferTimingModel` (which additionally requires red
 * evidence to produce a full plan) and `classifyControlType` (which only
 * needs the fit quality itself).
 */
function bestCycleFit(anchors: WeightedAnchor[]): { cycleSec: number; meanPhaseSec: number; resultantLength: number } | null {
  let best: { cycleSec: number; meanPhaseSec: number; resultantLength: number } | null = null;
  for (const cycleSec of CANDIDATE_CYCLES_SEC) {
    const { meanPhaseSec, resultantLength } = circularFit(anchors, cycleSec);
    const isBetter =
      !best ||
      resultantLength > best.resultantLength + 1e-9 ||
      (Math.abs(resultantLength - best.resultantLength) <= 1e-9 && cycleSec > best.cycleSec);
    if (isBetter) best = { cycleSec, meanPhaseSec, resultantLength };
  }
  return best;
}

function estimateRedSec(observations: DriveObservation[]): number | null {
  const waits: number[] = [];
  for (let i = 0; i < observations.length - 1; i++) {
    const stop = observations[i];
    if (stop.type !== "STOP_AT_SIGNAL") continue;
    const next = observations[i + 1];
    if (next.type !== "DEPART_SIGNAL" && next.type !== "GREEN_START_MANUAL") continue;
    const waitSec = (next.timestamp - stop.timestamp) / 1000;
    if (waitSec > 0 && waitSec <= MAX_PLAUSIBLE_WAIT_SEC) waits.push(waitSec);
  }
  if (waits.length < MIN_RED_SAMPLE_PAIRS) return null;
  const sorted = [...waits].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Attempts to infer a LearnedTimingModel from a signal's observation
 * history. Returns null when there isn't enough evidence — this is the
 * expected, common result for a signal seen only once or twice.
 */
export function inferTimingModel(observations: DriveObservation[]): LearnedTimingModel | null {
  const anchors = extractAnchors(observations);
  if (anchors.length < MIN_ANCHORS) return null;

  // Harmonics/sub-multiples of the true cycle can fit anchors just as well
  // (e.g. anchors spaced exactly 90s apart also perfectly "fit" a 30s or 45s
  // candidate). On a tie, prefer the larger candidate cycle — real urban
  // signal cycles are rarely under ~30s, and assuming the smallest fitting
  // period is more likely to alias than assuming the largest.
  const best = bestCycleFit(anchors);

  if (!best || best.resultantLength < MIN_RESULTANT_LENGTH) return null;

  const redSec = estimateRedSec(observations);
  if (redSec == null) return null; // green-start timing alone isn't enough for a usable full-cycle plan

  const greenSec = best.cycleSec - redSec - ASSUMED_YELLOW_SEC;
  if (greenSec <= 0) return null; // our red estimate doesn't fit this cycle plausibly; don't force it

  const recencyFactor = recencyConfidenceFactor(observations[observations.length - 1].timestamp);
  const sampleFactor = Math.min(1, anchors.length / 8);
  const confidence = Math.min(
    LEARNED_CONFIDENCE_CEILING,
    best.resultantLength * 0.5 + sampleFactor * 0.3 + recencyFactor * 0.2,
  );

  return {
    cycleSec: best.cycleSec,
    greenSec,
    yellowSec: ASSUMED_YELLOW_SEC,
    redSec,
    offsetSec: best.meanPhaseSec,
    confidence,
    sampleCount: anchors.length,
    updatedAt: Date.now(),
  };
}

const STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/** Learned models decay in confidence as they age — real signals can be retimed or run different schedules over time. */
export function recencyConfidenceFactor(lastObservedAt: number, now: number = Date.now()): number {
  const ageMs = now - lastObservedAt;
  if (ageMs <= 0) return 1;
  return Math.max(0, 1 - ageMs / STALE_AFTER_MS);
}

/** Applies time-based confidence decay to an already-computed model without re-running inference. */
export function decayModelConfidence(model: LearnedTimingModel, now: number = Date.now()): LearnedTimingModel {
  const factor = recencyConfidenceFactor(model.updatedAt, now);
  return { ...model, confidence: model.confidence * factor };
}

/**
 * Classifies whether a signal looks fixed/coordinated (green-start anchors
 * cluster tightly around one cycle length) or likely actuated (they don't,
 * or the "cycle" varies too much to trust). This does not attempt to
 * predict an actuated signal with a fixed-cycle model — that's exactly
 * what a mis-classification would risk, so `inferTimingModel` and this
 * function use the same fit-quality threshold to stay consistent.
 */
export function classifyControlType(observations: DriveObservation[]): ControlTypeClassification {
  const anchors = extractAnchors(observations);
  if (anchors.length < MIN_ANCHORS) return "UNKNOWN_CONTROL_TYPE";
  const best = bestCycleFit(anchors);
  if (!best) return "UNKNOWN_CONTROL_TYPE";
  return best.resultantLength >= MIN_RESULTANT_LENGTH ? "FIXED_OR_COORDINATED" : "LIKELY_ACTUATED";
}

/**
 * Re-anchors a learned model's phase offset from one new, high-quality
 * observation (a manual "TAP WHEN GREEN") without relearning the whole
 * cycle — cheaper and more responsive than waiting to re-run full
 * inference, and appropriate because a manual tap is strong, immediate
 * evidence of exactly when this cycle instance turned green. Only manual
 * anchors resynchronize; passive DEPART_SIGNAL events are too weak on
 * their own (a slow departure could lag the actual green start by a
 * couple of seconds) to justify moving an established offset.
 */
export function resynchronize(model: LearnedTimingModel, anchor: DriveObservation, now: number = Date.now()): LearnedTimingModel {
  if (anchor.type !== "GREEN_START_MANUAL") return model;
  const anchorPhaseSec = anchor.timestamp / 1000;
  const offsetSec = ((anchorPhaseSec % model.cycleSec) + model.cycleSec) % model.cycleSec;
  return {
    ...model,
    offsetSec,
    lastSynchronizedAt: now,
    synchronizationConfidence: anchor.confidence,
  };
}
