import type { GreenWindow, Intersection, SignalPhaseName, SignalPlan, SignalPrediction } from "@/lib/types";

/**
 * Deterministic signal-phase model.
 *
 * A signal's cycle is defined starting at green:
 *   [0, greenSec)                       -> green
 *   [greenSec, greenSec+yellowSec)      -> yellow
 *   [greenSec+yellowSec, cycleSec)      -> red
 *
 * `offsetSec` shifts this cycle relative to epoch 0 (Jan 1 1970 UTC), so a
 * signal is at the *start* of its green phase whenever
 * `(timestampSec - offsetSec) mod cycleSec === 0`.
 *
 * All internal arithmetic is done in integer-safe seconds derived from the
 * epoch-ms timestamp to avoid floating point drift; callers get results in
 * epoch ms.
 */

function assertValidPlan(plan: SignalPlan) {
  const sum = plan.greenSec + plan.yellowSec + plan.redSec;
  if (Math.abs(sum - plan.cycleSec) > 1e-6) {
    throw new Error(
      `Invalid SignalPlan: green+yellow+red (${sum}) must equal cycleSec (${plan.cycleSec})`,
    );
  }
  if (plan.cycleSec <= 0) {
    throw new Error("Invalid SignalPlan: cycleSec must be > 0");
  }
}

/** Normalizes an arbitrary (possibly negative) offset into [0, cycleSec). */
function normalizeOffset(offsetSec: number, cycleSec: number): number {
  const m = offsetSec % cycleSec;
  return m < 0 ? m + cycleSec : m;
}

/**
 * Position within the cycle, in seconds, in [0, cycleSec).
 * timestamp is epoch ms.
 */
export function cyclePosition(plan: SignalPlan, timestampMs: number): number {
  const offset = normalizeOffset(plan.offsetSec, plan.cycleSec);
  const tSec = timestampMs / 1000;
  // (t - offset) mod cycle, normalized to [0, cycle)
  const raw = (tSec - offset) % plan.cycleSec;
  return raw < 0 ? raw + plan.cycleSec : raw;
}

export function phaseAtCyclePosition(plan: SignalPlan, pos: number): SignalPhaseName {
  if (pos < plan.greenSec) return "green";
  if (pos < plan.greenSec + plan.yellowSec) return "yellow";
  return "red";
}

/** Returns the phase a signal is in at an arbitrary timestamp (epoch ms). */
export function getSignalPhaseAtTime(plan: SignalPlan, timestampMs: number): SignalPhaseName {
  assertValidPlan(plan);
  return phaseAtCyclePosition(plan, cyclePosition(plan, timestampMs));
}

/**
 * Returns the epoch-ms timestamp of the next phase transition strictly
 * after `timestampMs` (i.e. if you are exactly at a boundary, this returns
 * the *following* boundary, not the current instant).
 */
export function getNextPhaseTransition(plan: SignalPlan, timestampMs: number): number {
  assertValidPlan(plan);
  const pos = cyclePosition(plan, timestampMs);
  const boundaries = [plan.greenSec, plan.greenSec + plan.yellowSec, plan.cycleSec];
  const nextBoundary = boundaries.find((b) => b > pos + 1e-9) ?? plan.cycleSec + boundaries[0];
  const deltaSec = nextBoundary - pos;
  return timestampMs + deltaSec * 1000;
}

/**
 * Full prediction bundle for an intersection at an arrival timestamp:
 * current phase, time left in it, and the next green window.
 */
export function predictSignalState(intersection: Intersection, arrivalTimestampMs: number): SignalPrediction {
  const plan = intersection.signalPlan;
  assertValidPlan(plan);
  const pos = cyclePosition(plan, arrivalTimestampMs);
  const phase = phaseAtCyclePosition(plan, pos);
  const nextTransitionAt = getNextPhaseTransition(plan, arrivalTimestampMs);

  let nextGreenAt: number;
  let nextGreenEndsAt: number;
  if (phase === "green") {
    nextGreenAt = arrivalTimestampMs;
    nextGreenEndsAt = arrivalTimestampMs + (plan.greenSec - pos) * 1000;
  } else if (phase === "yellow") {
    const secToRed = plan.greenSec + plan.yellowSec - pos;
    const secToNextGreen = secToRed + plan.redSec;
    nextGreenAt = arrivalTimestampMs + secToNextGreen * 1000;
    nextGreenEndsAt = nextGreenAt + plan.greenSec * 1000;
  } else {
    const secToNextGreen = plan.cycleSec - pos;
    nextGreenAt = arrivalTimestampMs + secToNextGreen * 1000;
    nextGreenEndsAt = nextGreenAt + plan.greenSec * 1000;
  }

  return {
    intersectionId: intersection.id,
    phase,
    secondsRemainingInPhase: (nextTransitionAt - arrivalTimestampMs) / 1000,
    nextTransitionAt,
    nextGreenAt,
    nextGreenEndsAt,
    confidence: intersection.confidence,
  };
}

/**
 * Enumerates every green window ([startAt, endAt)) that begins within
 * [startTime, startTime + horizonSeconds*1000]. If the signal is already
 * green at startTime, the first window's startAt is clamped to startTime
 * (the window is still "in progress").
 */
export function getGreenWindows(plan: SignalPlan, startTime: number, horizonSeconds: number): GreenWindow[] {
  assertValidPlan(plan);
  const horizonEnd = startTime + horizonSeconds * 1000;
  const windows: GreenWindow[] = [];

  const pos = cyclePosition(plan, startTime);
  const phase = phaseAtCyclePosition(plan, pos);

  // Find the start of the first green window at or after startTime.
  let firstGreenStart: number;
  if (phase === "green") {
    firstGreenStart = startTime - pos * 1000;
  } else if (phase === "yellow") {
    const secToRed = plan.greenSec + plan.yellowSec - pos;
    firstGreenStart = startTime + (secToRed + plan.redSec) * 1000;
  } else {
    const secToGreen = plan.cycleSec - pos;
    firstGreenStart = startTime + secToGreen * 1000;
  }

  let cursor = firstGreenStart;
  let guard = 0;
  while (cursor <= horizonEnd && guard < 10_000) {
    const endAt = cursor + plan.greenSec * 1000;
    windows.push({ startAt: Math.max(cursor, startTime), endAt });
    cursor += plan.cycleSec * 1000;
    guard += 1;
  }
  return windows;
}
