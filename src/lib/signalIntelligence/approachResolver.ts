import type { DiscoveredSignal, Movement, Route, SignalApproach } from "@/lib/types";

/**
 * The physically nearest OSM traffic-signal node is not necessarily the
 * one that governs the route's movement through an intersection — a
 * physical signal can control northbound-through, northbound-left,
 * southbound-through, etc. separately. This resolver uses the route's own
 * turn-by-turn steps (which we already have — a real advantage over a
 * standalone, destination-unaware app) to pick the movement the *route*
 * actually makes at each discovered signal, defaulting to THROUGH only
 * when there's no evidence of a turn there.
 */

/** How close (meters) a signal must be to a step's maneuver point to attribute that maneuver to it. */
const MANEUVER_MATCH_TOLERANCE_M = 40;

const LEFT_MODIFIERS = new Set(["left", "slight left", "sharp left"]);
const RIGHT_MODIFIERS = new Set(["right", "slight right", "sharp right"]);

function movementFromManeuver(type: string, modifier: string | undefined): Movement {
  if (type === "arrive" || type === "depart" || type === "continue" || type === "new name" || type === "merge") {
    return "THROUGH";
  }
  if (!modifier) return "UNKNOWN";
  if (modifier === "uturn") return "U_TURN";
  if (LEFT_MODIFIERS.has(modifier)) return "LEFT";
  if (RIGHT_MODIFIERS.has(modifier)) return "RIGHT";
  if (modifier === "straight") return "THROUGH";
  return "UNKNOWN";
}

/** Cumulative distance (meters) along the route at the START of each step. */
function stepStartDistances(route: Route): number[] {
  const starts: number[] = [];
  let cumulative = 0;
  for (const step of route.steps) {
    starts.push(cumulative);
    cumulative += step.distanceM;
  }
  return starts;
}

export type ApproachResolution = {
  approach: SignalApproach;
  /** How confident we are that `approach.maneuver` reflects what the route actually does here — distinct from directionConfidence (whether the signal applies to our direction at all). */
  movementConfidence: number;
};

export function resolveApproach(signal: DiscoveredSignal, route: Route): ApproachResolution {
  const starts = stepStartDistances(route);

  let bestStepIdx = -1;
  let bestDistanceDelta = Infinity;
  for (let i = 0; i < starts.length; i++) {
    const delta = Math.abs(starts[i] - signal.distanceAlongRouteM);
    if (delta < bestDistanceDelta) {
      bestDistanceDelta = delta;
      bestStepIdx = i;
    }
  }

  let movement: Movement = "THROUGH";
  let movementConfidence = 0.6; // default assumption: mid-block / straight-through signal, no turn evidence

  if (bestStepIdx >= 0 && bestDistanceDelta <= MANEUVER_MATCH_TOLERANCE_M) {
    const step = route.steps[bestStepIdx];
    const resolved = movementFromManeuver(step.maneuver.type, step.maneuver.modifier);
    if (resolved !== "UNKNOWN") {
      movement = resolved;
      // Closer match + an explicit maneuver = more confident we've got the right movement.
      movementConfidence = 0.9 - (bestDistanceDelta / MANEUVER_MATCH_TOLERANCE_M) * 0.15;
    } else {
      movement = "UNKNOWN";
      movementConfidence = 0.4;
    }
  }

  const approach: SignalApproach = {
    signalId: signal.id,
    approachId: `${signal.id}:${movement}`,
    direction: signal.routeHeadingDeg,
    maneuver: movement,
  };

  return { approach, movementConfidence };
}

/**
 * Combined confidence that (a) this signal applies to our direction of
 * travel at all, and (b) we've matched the right movement at it. Both
 * must hold for the signal to be usable for precise advice — see
 * SignalIntelligenceEngine.
 */
export function combinedApproachConfidence(signal: DiscoveredSignal, resolution: ApproachResolution): number {
  return Math.min(signal.directionConfidence, resolution.movementConfidence);
}
