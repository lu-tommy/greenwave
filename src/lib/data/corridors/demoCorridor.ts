import { mphToMps } from "@/lib/geo/units";
import type { Corridor, Intersection, LatLng, SignalPlan } from "@/lib/types";

/**
 * DEMO CORRIDOR — SIMULATED SIGNAL DATA.
 *
 * This is fictional demo timing, not official DOT signal data. It exists to
 * exercise the signal engine, optimizer, and simulator end to end.
 *
 * Design: a 10-light corridor split into two halves.
 *   - Lights 0-5 are coordinated for a ~21 mph progression speed (a classic
 *     green wave) relative to REFERENCE_TIMESTAMP.
 *   - Lights 6-9 are deliberately NOT coordinated with that progression
 *     (their cycles are phased so a 21 mph arrival lands at the start of
 *     red), simulating a corridor segment with a conflicting cross-street
 *     priority plan. This is what lets scenarios like STOP REQUIRED and
 *     MISSED WINDOW demonstrate honest, non-fabricated behavior: the
 *     optimizer has to recommend coasting/stopping there because no legal
 *     speed produces a clean green.
 */

export const REFERENCE_TIMESTAMP = Date.UTC(2026, 5, 1, 8, 0, 0, 0);

const SPEED_LIMIT_MPH = 25;
export const SPEED_LIMIT_MPS = mphToMps(SPEED_LIMIT_MPH);

const PROGRESSION_SPEED_MPH = 21;
const PROGRESSION_SPEED_MPS = mphToMps(PROGRESSION_SPEED_MPH);

const CYCLE_SEC = 60;
const GREEN_SEC = 28;
const YELLOW_SEC = 3;
const RED_SEC = CYCLE_SEC - GREEN_SEC - YELLOW_SEC; // 29
const RED_START_POS = GREEN_SEC + YELLOW_SEC; // 31

function mod(a: number, n: number): number {
  const r = a % n;
  return r < 0 ? r + n : r;
}

type IntersectionSpec = {
  name: string;
  distanceM: number;
  /** Cycle position (sec) a vehicle at PROGRESSION_SPEED arrives at, relative to REFERENCE_TIMESTAMP. 0 = green start, RED_START_POS = red start. */
  targetArrivalPos: number;
  confidence: number;
  lastCalibratedAt: number;
};

const RECENT_CALIBRATION = Date.UTC(2026, 4, 20);
const STALE_CALIBRATION = Date.UTC(2025, 9, 3);

const SPECS: IntersectionSpec[] = [
  { name: "Elm St", distanceM: 300, targetArrivalPos: 0, confidence: 0.96, lastCalibratedAt: RECENT_CALIBRATION },
  { name: "Oak St", distanceM: 680, targetArrivalPos: 0, confidence: 0.95, lastCalibratedAt: RECENT_CALIBRATION },
  { name: "Pine St", distanceM: 1040, targetArrivalPos: 0, confidence: 0.94, lastCalibratedAt: RECENT_CALIBRATION },
  { name: "Maple St", distanceM: 1430, targetArrivalPos: 0, confidence: 0.93, lastCalibratedAt: RECENT_CALIBRATION },
  { name: "Cedar St", distanceM: 1810, targetArrivalPos: 0, confidence: 0.95, lastCalibratedAt: RECENT_CALIBRATION },
  { name: "Birch St", distanceM: 2190, targetArrivalPos: 0, confidence: 0.92, lastCalibratedAt: RECENT_CALIBRATION },
  { name: "Walnut St", distanceM: 2650, targetArrivalPos: RED_START_POS, confidence: 0.9, lastCalibratedAt: RECENT_CALIBRATION },
  { name: "Chestnut St", distanceM: 3050, targetArrivalPos: RED_START_POS, confidence: 0.88, lastCalibratedAt: RECENT_CALIBRATION },
  { name: "Spruce St", distanceM: 3520, targetArrivalPos: RED_START_POS, confidence: 0.32, lastCalibratedAt: STALE_CALIBRATION },
  { name: "Willow St", distanceM: 3980, targetArrivalPos: RED_START_POS, confidence: 0.85, lastCalibratedAt: RECENT_CALIBRATION },
];

function buildSignalPlan(distanceM: number, targetArrivalPos: number): SignalPlan {
  const arrivalTimeSec = REFERENCE_TIMESTAMP / 1000 + distanceM / PROGRESSION_SPEED_MPS;
  const offsetSec = Math.round(mod(arrivalTimeSec - targetArrivalPos, CYCLE_SEC) * 10) / 10;
  return { cycleSec: CYCLE_SEC, greenSec: GREEN_SEC, yellowSec: YELLOW_SEC, redSec: RED_SEC, offsetSec };
}

const LAT0 = 39.7392;
const LNG0 = -104.9903;
const METERS_PER_DEG_LAT = 111_320;
const METERS_PER_DEG_LNG = METERS_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

function latLngAtDistance(distanceM: number): LatLng {
  return { lat: LAT0, lng: LNG0 + distanceM / METERS_PER_DEG_LNG };
}

const intersections: Intersection[] = SPECS.map((spec, idx) => ({
  id: `demo-int-${idx + 1}`,
  name: spec.name,
  ...latLngAtDistance(spec.distanceM),
  distanceAlongCorridorM: spec.distanceM,
  signalPlan: buildSignalPlan(spec.distanceM, spec.targetArrivalPos),
  confidence: spec.confidence,
  lastCalibratedAt: spec.lastCalibratedAt,
}));

const CORRIDOR_START_M = -150;
const CORRIDOR_END_M = 4300;
const polyline: LatLng[] = [];
for (let d = CORRIDOR_START_M; d <= CORRIDOR_END_M; d += 250) {
  polyline.push(latLngAtDistance(d));
}
polyline.push(latLngAtDistance(CORRIDOR_END_M));

export const demoCorridor: Corridor = {
  id: "demo-corridor-eastbound",
  name: "Demo Corridor Eastbound",
  direction: "Eastbound",
  speedLimitMps: SPEED_LIMIT_MPS,
  polyline,
  intersections,
  dataSourceLabel: "SIMULATED SIGNAL DATA",
};

export const DEMO_PROGRESSION_SPEED_MPS = PROGRESSION_SPEED_MPS;

export const demoCorridors: Corridor[] = [demoCorridor];
