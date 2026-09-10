import type { Confidence, SignalPlan } from "./index";

/**
 * The Signal Intelligence layer's normalized data model.
 *
 * This is deliberately a superset of the plain `SignalPlan` (fixed
 * cycle/green/yellow/red) model the original engine used: a real SPaT feed
 * doesn't describe a signal as a repeating cycle, it describes a *predicted
 * transition window* (min/likely/max end time) for whatever phase it's
 * currently in. `SignalPlan` remains exactly as it was — it's still what
 * powers the deterministic demo corridor and the Manual/Learned/Static
 * providers — but everything downstream of "what should the driver see"
 * now speaks this richer, source-aware model instead.
 *
 * Signal LOCATION (from OSM) and signal TIMING (from here) are always
 * separate concepts — see SignalApproach vs SignalTimingEvidence below.
 */

// ---------------------------------------------------------------------------
// Source & confidence
// ---------------------------------------------------------------------------

/**
 * Where a piece of timing evidence came from. Ordered roughly by how much
 * a driver should trust it — but see SignalIntelligenceEngine for why that
 * ordering isn't applied blindly (freshness and confidence both matter more
 * than source rank alone).
 */
export type SignalSource =
  | "OFFICIAL_LIVE" // a real SPaT/V2X feed from the traffic authority — not implemented against any live feed today
  | "OFFICIAL_STATIC" // a published, authoritative fixed timing plan (e.g. a DOT signal timing chart) — not connected to any real one today
  | "EXTERNAL_LIVE" // a third-party live signal-timing service (e.g. a licensed feed) — not implemented today
  | "LEARNED" // inferred from this app's own drive observations
  | "MANUAL" // calibrated by hand via the Calibration page
  | "HISTORICAL" // a learned model that has decayed past normal freshness but is kept as a weak prior
  | "UNKNOWN"; // no evidence at all

export type ConfidenceTier = "HIGH" | "ESTIMATED" | "UNAVAILABLE";

// ---------------------------------------------------------------------------
// Approach & movement — a physical signal is not one universal timer
// ---------------------------------------------------------------------------

export type Movement = "THROUGH" | "LEFT" | "RIGHT" | "U_TURN" | "UNKNOWN";

/**
 * One directional approach to one physical signal. A single OSM
 * traffic-signal node can have several of these (northbound through,
 * northbound left, southbound through, ...) — timing should be looked up
 * by (signalId, movement), not by signalId alone.
 */
export type SignalApproach = {
  signalId: string;
  /** Stable, derived id: `${signalId}:${movement}` today; room for real per-lane approach ids later. */
  approachId: string;
  /** Degrees, the direction of travel this approach serves. `null` if unknown. */
  direction: number | null;
  maneuver: Movement;
  laneIds?: string[];
};

// ---------------------------------------------------------------------------
// Phase & timing evidence
// ---------------------------------------------------------------------------

export type SignalPhaseStateName = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";

export type SignalPhaseState = {
  state: SignalPhaseStateName;
  observedAt: number;
  /** When this observation stops being trustworthy on its own, epoch ms. `null` = provider doesn't know / doesn't expire on a fixed schedule. */
  validUntil: number | null;
  source: SignalSource;
};

/**
 * Raw evidence returned by a single SignalIntelligenceProvider. Deliberately
 * a *window*, not a single instant: min/likely/max end time lets a provider
 * express "I know this phase ends between 10 and 18 seconds from now, most
 * likely around 14" — which is what real SPaT and honest learned models
 * actually produce, unlike a fabricated exact countdown.
 */
export type SignalTimingEvidence = {
  source: SignalSource;
  /** `null` only when the provider has literally no phase information. */
  phase: SignalPhaseStateName | null;
  /** Epoch ms bounds for when the *current* phase ends. All `null` if unknown. */
  minEndTime: number | null;
  likelyEndTime: number | null;
  maxEndTime: number | null;
  /** Epoch ms bounds for when the *next* green begins/ends, if derivable. */
  nextGreenStart: number | null;
  nextGreenEnd: number | null;
  confidence: Confidence;
  observedAt: number;
  metadata?: Record<string, unknown>;
};

/** A SignalTimingEvidence that has been fused/aged by the engine at query time. */
export type SignalTimingEstimate = SignalTimingEvidence & {
  /** How old this evidence was, in ms, at the moment it was evaluated. */
  freshnessMs: number;
};

// ---------------------------------------------------------------------------
// SPaT-native representation (SAE J2735-inspired subset, not the full standard)
// ---------------------------------------------------------------------------

export type SpatEvent = {
  state: SignalPhaseStateName;
  /** Epoch ms. Required — the one thing every real SPaT event carries. */
  minEndTime: number;
  likelyEndTime?: number;
  maxEndTime?: number;
};

export type SpatSignalGroup = {
  signalGroupId: string;
  movement: Movement;
  events: SpatEvent[];
};

export type SpatIntersectionState = {
  intersectionId: string;
  /** Epoch ms — when this message was generated/observed. */
  timestamp: number;
  signalGroups: SpatSignalGroup[];
};

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

/**
 * A source of signal-timing evidence. Providers answer "what do you know
 * about this approach at this time" — they never decide what the UI shows;
 * that's SignalIntelligenceEngine's job (fusion, precedence, freshness,
 * confidence gating).
 */
export interface SignalIntelligenceProvider {
  getTiming(approach: SignalApproach, atTime: number): Promise<SignalTimingEvidence | null>;
}

// ---------------------------------------------------------------------------
// Learned timing profile (approach + time-of-day — schema-ready, not fully scheduled yet)
// ---------------------------------------------------------------------------

export type ControlTypeClassification = "FIXED_OR_COORDINATED" | "LIKELY_ACTUATED" | "UNKNOWN_CONTROL_TYPE";

export type SignalTimingProfile = {
  approachId: string;
  /** 0 (Sunday) - 6 (Saturday); empty/absent = applies any day. Not yet used to select between multiple profiles — one profile per approach today. */
  daysOfWeek?: number[];
  /** Minutes since midnight, local time. */
  startTimeOfDay?: number;
  endTimeOfDay?: number;
  cycleEstimate: SignalPlan | null;
  offsetEstimateSec: number | null;
  uncertainty: number;
  observationCount: number;
  controlType: ControlTypeClassification;
  lastSynchronizedAt: number | null;
  synchronizationConfidence: Confidence;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// Corridor coordination (exploiting shared progression between signals)
// ---------------------------------------------------------------------------

export type CoordinationGroup = {
  id: string;
  signalIds: string[];
  /** Shared cycle length if the group appears coordinated, else null. */
  sharedCycleSec: number | null;
  confidence: Confidence;
};
