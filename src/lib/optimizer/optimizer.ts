import { getSignalPhaseAtTime, predictSignalState } from "@/lib/signals/signalEngine";
import { mphToMps } from "@/lib/geo/units";
import { estimateArrival } from "./kinematics";
import type {
  CandidateSpeedScore,
  Corridor,
  DriveInstruction,
  DriveRecommendation,
  Intersection,
  OptimizationResult,
  OptimizerConstraints,
  UpcomingLightForecast,
  VehicleState,
} from "@/lib/types";

export const DEFAULT_CONSTRAINTS: OptimizerConstraints = {
  maxAcceleration: 1.5, // m/s^2, ~gentle city acceleration
  maxComfortableDeceleration: 1.5, // m/s^2
  hardBrakingThreshold: 2.8, // m/s^2
  hardAccelThreshold: 2.2, // m/s^2
  minUsefulSpeedMps: mphToMps(5),
  horizonSec: 300,
  maxIntersectionsAhead: 6,
  comfortWeight: 0.55,
  speedStepMps: mphToMps(0.5),
};

const HOLD_EPSILON_MPS = 0.3; // ~0.67 mph: below this, treat speed as "unchanged"
const GENTLE_REDUCTION_MPS = mphToMps(4);

function getUpcomingIntersections(
  corridor: Corridor,
  vehicle: VehicleState,
  constraints: OptimizerConstraints,
): Intersection[] {
  // Cap how far ahead we look by the optimization horizon: an intersection
  // that can't plausibly be reached (even at the speed limit) within
  // horizonSec is outside the planning window, not part of "upcoming".
  const maxReachableDistanceM = constraints.horizonSec * corridor.speedLimitMps;
  return corridor.intersections
    .filter((i) => i.distanceAlongCorridorM > vehicle.positionM)
    .filter((i) => i.distanceAlongCorridorM - vehicle.positionM <= maxReachableDistanceM)
    .sort((a, b) => a.distanceAlongCorridorM - b.distanceAlongCorridorM)
    .slice(0, constraints.maxIntersectionsAhead);
}

/**
 * Deceleration/acceleration rate (m/s^2) implied by transitioning from
 * currentSpeed to candidateSpeed by the time the vehicle reaches
 * `distanceM`, using v^2 = v0^2 + 2*a*d. This is a proxy for "how hard
 * would I have to brake/accelerate right now" and is distinct from the
 * cruise-transition rate used for ETA estimation (which assumes unlimited
 * following distance). Used purely as a comfort-penalty signal.
 */
function impliedRate(currentSpeedMps: number, candidateSpeedMps: number, distanceM: number): number {
  if (distanceM <= 1) return 0;
  return Math.abs(candidateSpeedMps ** 2 - currentSpeedMps ** 2) / (2 * distanceM);
}

function evaluateCandidate(
  corridor: Corridor,
  vehicle: VehicleState,
  upcoming: Intersection[],
  candidateSpeedMps: number,
  constraints: OptimizerConstraints,
): CandidateSpeedScore & { forecasts: UpcomingLightForecast[] } {
  let stopsRequired = 0;
  let greensCaught = 0;
  let consecutiveGreens = 0;
  let consecutiveBroken = false;
  let yellowArrivals = 0;
  let hardBrakingEvents = 0;
  let hardAccelEvents = 0;
  let lastEtaSec = 0;
  const forecasts: UpcomingLightForecast[] = [];

  const firstDistance = upcoming.length > 0 ? upcoming[0].distanceAlongCorridorM - vehicle.positionM : Infinity;
  const rate = impliedRate(vehicle.speedMps, candidateSpeedMps, firstDistance);
  if (candidateSpeedMps < vehicle.speedMps - HOLD_EPSILON_MPS && rate > constraints.hardBrakingThreshold) {
    hardBrakingEvents += 1;
  }
  if (candidateSpeedMps > vehicle.speedMps + HOLD_EPSILON_MPS && rate > constraints.hardAccelThreshold) {
    hardAccelEvents += 1;
  }

  for (const intersection of upcoming) {
    const distanceM = intersection.distanceAlongCorridorM - vehicle.positionM;
    const { etaSec } = estimateArrival(
      distanceM,
      vehicle.speedMps,
      candidateSpeedMps,
      constraints.maxAcceleration,
      constraints.maxComfortableDeceleration,
    );
    lastEtaSec = etaSec;
    const arrivalTimestamp = vehicle.timestamp + etaSec * 1000;
    const phase = getSignalPhaseAtTime(intersection.signalPlan, arrivalTimestamp);

    forecasts.push({
      intersectionId: intersection.id,
      name: intersection.name,
      distanceM,
      etaMs: etaSec * 1000,
      predictedPhaseAtArrival: phase,
      arrivalConfidence: intersection.confidence,
    });

    if (phase === "green") {
      greensCaught += 1;
      if (!consecutiveBroken) consecutiveGreens += 1;
    } else {
      consecutiveBroken = true;
      if (phase === "red") stopsRequired += 1;
      if (phase === "yellow") yellowArrivals += 1;
    }
  }

  const travelTimeSec = lastEtaSec || (firstDistance !== Infinity ? firstDistance / Math.max(candidateSpeedMps, 0.1) : 0);
  const speedVariationMps = Math.abs(candidateSpeedMps - vehicle.speedMps);

  const comfortPenalty =
    stopsRequired * 40 +
    hardBrakingEvents * 55 +
    hardAccelEvents * 45 +
    yellowArrivals * 15 +
    Math.min(speedVariationMps, mphToMps(15)) * 1.2;

  const progressReward = consecutiveGreens * 28 + greensCaught * 10 - travelTimeSec * 0.4;

  const score = (1 - constraints.comfortWeight) * progressReward - constraints.comfortWeight * comfortPenalty;

  return {
    speedMps: candidateSpeedMps,
    score,
    stopsRequired,
    greensCaught,
    hardBrakingEvents,
    hardAccelEvents,
    travelTimeSec,
    feasible: candidateSpeedMps <= corridor.speedLimitMps + 1e-6 && candidateSpeedMps >= 0,
    forecasts,
  };
}

function classifyInstruction(
  candidateSpeedMps: number,
  vehicle: VehicleState,
  constraints: OptimizerConstraints,
  firstIntersectionDistanceM: number,
  nextGreenReachable: boolean,
  nextIsUnknown: boolean,
): DriveInstruction {
  const delta = candidateSpeedMps - vehicle.speedMps;

  if (Math.abs(delta) <= HOLD_EPSILON_MPS) return "HOLD";
  if (delta > 0) return "ACCELERATE_GENTLY";

  // Never "prepare to stop" for a signal we have no timing model for — that
  // would fabricate certainty about a red we can't actually predict.
  const nearMinSpeed = candidateSpeedMps <= constraints.minUsefulSpeedMps + HOLD_EPSILON_MPS;
  if (nearMinSpeed && !nextIsUnknown && !nextGreenReachable && firstIntersectionDistanceM < Infinity) {
    return "PREPARE_TO_STOP";
  }
  return Math.abs(delta) <= GENTLE_REDUCTION_MPS ? "COAST" : "SLOW";
}

function buildReason(
  instruction: DriveInstruction,
  isGreenWave: boolean,
  greenWaveCount: number,
  upcoming: UpcomingLightForecast[],
  secondsToNextGreenFromNow: number | null,
): string {
  if (isGreenWave && (instruction === "HOLD" || instruction === "ACCELERATE_GENTLY")) {
    return `GREEN WAVE · ${greenWaveCount} LIGHT${greenWaveCount === 1 ? "" : "S"}`;
  }
  if (instruction === "PREPARE_TO_STOP") {
    if (secondsToNextGreenFromNow != null) {
      return `RED AHEAD · NEXT GREEN IN ${Math.round(secondsToNextGreenFromNow)}s`;
    }
    return "RED AHEAD";
  }

  const nextIsUnknown = upcoming[0]?.predictedPhaseAtArrival === "unknown";
  if (nextIsUnknown) {
    const anyKnownDownstream = upcoming.some((f) => f.predictedPhaseAtArrival !== "unknown");
    return anyKnownDownstream ? "LIMITED SIGNAL DATA" : "LEARNING ROUTE";
  }

  if (instruction === "COAST" || instruction === "SLOW") {
    return upcoming[0]?.predictedPhaseAtArrival === "green" ? "TIMING TO NEXT GREEN" : "EASING FOR RED AHEAD";
  }
  if (instruction === "HOLD") return "ON PACE";
  return "ADJUSTING TO TRAFFIC FLOW";
}

/**
 * Smooths a new recommendation against the previous one to avoid flicker:
 * small speed deltas (< ~1 mph) snap back to the previous target, and the
 * semantic instruction only changes if the new choice is meaningfully
 * better or the situation materially changed (handled upstream by the
 * caller re-running the full search — here we just damp noise).
 */
export function smoothRecommendation(
  next: DriveRecommendation,
  previous: DriveRecommendation | null,
): DriveRecommendation {
  if (!previous) return next;
  const FLICKER_GUARD_MPS = mphToMps(1);
  const sameInstruction = previous.instruction === next.instruction;
  const delta = Math.abs(next.targetSpeedMps - previous.targetSpeedMps);

  if (sameInstruction && delta < FLICKER_GUARD_MPS) {
    return { ...next, targetSpeedMps: previous.targetSpeedMps };
  }
  return next;
}

export function optimize(
  corridor: Corridor,
  vehicle: VehicleState,
  constraints: OptimizerConstraints = DEFAULT_CONSTRAINTS,
  previousRecommendation: DriveRecommendation | null = null,
  includeCandidates = false,
): OptimizationResult {
  const upcoming = getUpcomingIntersections(corridor, vehicle, constraints);

  const speedLimit = corridor.speedLimitMps;
  const candidates: (CandidateSpeedScore & { forecasts: UpcomingLightForecast[] })[] = [];

  for (let s = constraints.minUsefulSpeedMps; s <= speedLimit + 1e-6; s += constraints.speedStepMps) {
    candidates.push(evaluateCandidate(corridor, vehicle, upcoming, Math.min(s, speedLimit), constraints));
  }
  // Always include the exact speed limit and a near-stop candidate as edge cases.
  candidates.push(evaluateCandidate(corridor, vehicle, upcoming, speedLimit, constraints));
  candidates.push(evaluateCandidate(corridor, vehicle, upcoming, constraints.minUsefulSpeedMps, constraints));

  const feasible = candidates.filter((c) => c.feasible);
  const best = feasible.reduce((a, b) => (b.score > a.score ? b : a), feasible[0]);

  const firstDistance = upcoming.length > 0 ? upcoming[0].distanceAlongCorridorM - vehicle.positionM : Infinity;
  const nextGreenReachable = best.forecasts[0]?.predictedPhaseAtArrival === "green";
  const nextIsUnknown = best.forecasts[0]?.predictedPhaseAtArrival === "unknown";

  const instruction = classifyInstruction(
    best.speedMps,
    vehicle,
    constraints,
    firstDistance,
    nextGreenReachable,
    nextIsUnknown,
  );
  const greenWaveCount = best.forecasts.reduce((count, f, idx) => {
    if (idx === count && f.predictedPhaseAtArrival === "green") return count + 1;
    return count;
  }, 0);
  const isGreenWave = greenWaveCount >= 2;

  const nextGreenAtFromNow = upcoming.length > 0 ? predictSignalState(upcoming[0], vehicle.timestamp).nextGreenAt : null;
  const secondsToNextGreenFromNow = nextGreenAtFromNow != null ? (nextGreenAtFromNow - vehicle.timestamp) / 1000 : null;

  const confidence = upcoming.length > 0 ? Math.min(...upcoming.map((i) => i.confidence)) : 1;

  // Low-confidence downstream data -> fall back toward current legal cruising
  // rather than asserting a precise recommendation the engine can't back up.
  // Only clamps toward "current speed" when current speed is itself a real,
  // established cruising speed — at the very start of a drive (or the first
  // GPS fix, before a speed can be derived) vehicle.speedMps is 0, and
  // clamping to that would incorrectly pin the recommendation at 0 forever.
  const hasEstablishedSpeed = vehicle.speedMps > constraints.minUsefulSpeedMps;
  const conservativeSpeed =
    confidence < 0.4 && hasEstablishedSpeed ? Math.min(best.speedMps, vehicle.speedMps, speedLimit) : best.speedMps;

  const rec: DriveRecommendation = {
    timestamp: vehicle.timestamp,
    instruction,
    targetSpeedMps: Math.min(conservativeSpeed, speedLimit),
    speedLimitMps: speedLimit,
    greenWaveCount,
    isGreenWave,
    upcoming: best.forecasts,
    confidence,
    reason: buildReason(instruction, isGreenWave, greenWaveCount, best.forecasts, secondsToNextGreenFromNow),
  };

  const smoothed = smoothRecommendation(rec, previousRecommendation);

  return {
    recommendation: smoothed,
    candidates: includeCandidates ? candidates.map(toCandidateScore) : [],
  };
}

function toCandidateScore(c: CandidateSpeedScore & { forecasts: UpcomingLightForecast[] }): CandidateSpeedScore {
  return {
    speedMps: c.speedMps,
    score: c.score,
    stopsRequired: c.stopsRequired,
    greensCaught: c.greensCaught,
    hardBrakingEvents: c.hardBrakingEvents,
    hardAccelEvents: c.hardAccelEvents,
    travelTimeSec: c.travelTimeSec,
    feasible: c.feasible,
  };
}
