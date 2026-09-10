import { describe, expect, it } from "vitest";
import { DEFAULT_CONSTRAINTS, optimize, smoothRecommendation } from "./optimizer";
import { mphToMps, mpsToMph } from "@/lib/geo/units";
import type { Corridor, DriveRecommendation, Intersection, VehicleState } from "@/lib/types";
import { demoCorridor, DEMO_PROGRESSION_SPEED_MPS, REFERENCE_TIMESTAMP } from "@/lib/data/corridors/demoCorridor";

function makeIntersection(overrides: Partial<Intersection>): Intersection {
  return {
    id: "int",
    name: "Test St",
    lat: 0,
    lng: 0,
    distanceAlongCorridorM: 500,
    signalPlan: { cycleSec: 60, greenSec: 28, yellowSec: 3, redSec: 29, offsetSec: 0 },
    confidence: 0.95,
    ...overrides,
  };
}

function makeCorridor(intersections: Intersection[], speedLimitMph = 25): Corridor {
  return {
    id: "test-corridor",
    name: "Test Corridor",
    direction: "Eastbound",
    speedLimitMps: mphToMps(speedLimitMph),
    polyline: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }],
    intersections,
    dataSourceLabel: "SIMULATED SIGNAL DATA",
  };
}

describe("optimize: legal green wave on the demo corridor", () => {
  it("recommends a legal ~20-22 mph trajectory that catches the coordinated wave", () => {
    const vehicle: VehicleState = {
      timestamp: REFERENCE_TIMESTAMP,
      positionM: 0,
      speedMps: DEMO_PROGRESSION_SPEED_MPS,
    };
    const result = optimize(demoCorridor, vehicle, DEFAULT_CONSTRAINTS, null, true);
    const mph = mpsToMph(result.recommendation.targetSpeedMps);

    expect(mph).toBeGreaterThanOrEqual(19);
    expect(mph).toBeLessThanOrEqual(23);
    expect(result.recommendation.targetSpeedMps).toBeLessThanOrEqual(demoCorridor.speedLimitMps + 1e-6);
    expect(result.recommendation.greenWaveCount).toBeGreaterThanOrEqual(4);
    expect(result.recommendation.isGreenWave).toBe(true);
  });
});

describe("optimize: never recommends exceeding the speed limit", () => {
  it("does not recommend 31 mph on a 25 mph road even when that is the only speed that catches the green", () => {
    // Distance chosen so the signal is green only for a vehicle arriving at ~31mph;
    // at any legal (<=25mph) candidate speed the arrival lands in red.
    const distanceM = 500;
    const arrivalAt31 = distanceM / mphToMps(31);
    // A very long cycle so the *next* recurrence of green is far beyond
    // reach of any legal speed (this isolates the case where literally no
    // legal candidate — on this cycle or a later one — catches a green).
    const plan = {
      cycleSec: 600,
      greenSec: 10,
      yellowSec: 3,
      redSec: 587,
      offsetSec: arrivalAt31 - 5, // green window centered near the 31mph arrival time
    };
    const corridor = makeCorridor([makeIntersection({ distanceAlongCorridorM: distanceM, signalPlan: plan })], 25);
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: mphToMps(24) };

    const result = optimize(corridor, vehicle, DEFAULT_CONSTRAINTS, null, true);

    expect(result.recommendation.targetSpeedMps).toBeLessThanOrEqual(mphToMps(25) + 1e-6);
    for (const c of result.candidates) {
      expect(c.speedMps).toBeLessThanOrEqual(mphToMps(25) + 1e-6);
    }
    // The engine must not report that green as "caught" in its chosen recommendation.
    expect(result.recommendation.upcoming[0]?.predictedPhaseAtArrival).not.toBe("green");
  });
});

describe("optimize: coasts instead of driving into an unavoidable red", () => {
  it("recommends slowing rather than holding 24 mph when the next green is too far away", () => {
    // Red light close ahead; the next green starts long after any comfortable
    // arrival window at 24mph, so the vehicle should not just hold speed into it.
    const distanceM = 200;
    const plan = {
      cycleSec: 120,
      greenSec: 20,
      yellowSec: 3,
      redSec: 97,
      offsetSec: 60, // arranged so "now" (t=0) is early in a long red
    };
    const corridor = makeCorridor([makeIntersection({ distanceAlongCorridorM: distanceM, signalPlan: plan })], 30);
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: mphToMps(24) };

    const result = optimize(corridor, vehicle, DEFAULT_CONSTRAINTS);

    expect(result.recommendation.targetSpeedMps).toBeLessThan(mphToMps(24) - 0.1);
    expect(["COAST", "SLOW", "PREPARE_TO_STOP"]).toContain(result.recommendation.instruction);
  });
});

describe("optimize: with no upcoming intersections", () => {
  it("holds current legal speed and reports no green wave", () => {
    const corridor = makeCorridor([]);
    const vehicle: VehicleState = { timestamp: 0, positionM: 4000, speedMps: mphToMps(22) };
    const result = optimize(corridor, vehicle);
    expect(result.recommendation.upcoming).toHaveLength(0);
    expect(result.recommendation.isGreenWave).toBe(false);
  });
});

describe("optimize: low confidence produces a more conservative recommendation", () => {
  it("does not exceed current speed when downstream confidence is very low", () => {
    const plan = { cycleSec: 60, greenSec: 55, yellowSec: 2, redSec: 3, offsetSec: 0 };
    const corridor = makeCorridor([
      makeIntersection({ distanceAlongCorridorM: 800, confidence: 0.15, signalPlan: plan }),
    ]);
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: mphToMps(18) };
    const result = optimize(corridor, vehicle);
    expect(result.recommendation.targetSpeedMps).toBeLessThanOrEqual(mphToMps(18) + 1e-6);
    expect(result.recommendation.confidence).toBeLessThan(0.4);
  });
});

describe("smoothRecommendation", () => {
  const base: DriveRecommendation = {
    timestamp: 0,
    instruction: "HOLD",
    targetSpeedMps: mphToMps(21),
    speedLimitMps: mphToMps(25),
    greenWaveCount: 3,
    greenWaveDistanceM: 500,
    isGreenWave: true,
    upcoming: [],
    confidence: 0.9,
    reason: "GREEN WAVE · 3 LIGHTS",
  };

  it("snaps small same-instruction speed changes back to the previous value to avoid flicker", () => {
    const next: DriveRecommendation = { ...base, targetSpeedMps: base.targetSpeedMps + mphToMps(0.5) };
    const smoothed = smoothRecommendation(next, base);
    expect(smoothed.targetSpeedMps).toBe(base.targetSpeedMps);
  });

  it("allows a large same-instruction speed change through", () => {
    const next: DriveRecommendation = { ...base, targetSpeedMps: base.targetSpeedMps + mphToMps(5) };
    const smoothed = smoothRecommendation(next, base);
    expect(smoothed.targetSpeedMps).toBe(next.targetSpeedMps);
  });

  it("allows a change through immediately when the instruction changes", () => {
    const next: DriveRecommendation = {
      ...base,
      instruction: "SLOW",
      targetSpeedMps: base.targetSpeedMps + mphToMps(0.5),
    };
    const smoothed = smoothRecommendation(next, base);
    expect(smoothed.targetSpeedMps).toBe(next.targetSpeedMps);
  });
});

describe("optimize: unknown signal timing safety (route mode)", () => {
  it("never reports 'green' for an intersection with no signal plan", () => {
    const corridor = makeCorridor([makeIntersection({ signalPlan: null, confidence: 0 })]);
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: mphToMps(20) };
    const result = optimize(corridor, vehicle);
    expect(result.recommendation.upcoming[0].predictedPhaseAtArrival).toBe("unknown");
  });

  it("does not classify PREPARE_TO_STOP for an unknown next signal even at low speed", () => {
    // Very close unknown signal — if it were treated as an unreachable red,
    // this would previously trigger PREPARE_TO_STOP. It must not.
    const corridor = makeCorridor([
      makeIntersection({ distanceAlongCorridorM: 30, signalPlan: null, confidence: 0 }),
    ]);
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: mphToMps(25) };
    const result = optimize(corridor, vehicle);
    expect(result.recommendation.instruction).not.toBe("PREPARE_TO_STOP");
  });

  it("does not claim a green wave when the very next signal is unknown, even if downstream signals are known green", () => {
    const knownGreenPlan = { cycleSec: 60, greenSec: 55, yellowSec: 2, redSec: 3, offsetSec: 0 };
    const corridor = makeCorridor([
      makeIntersection({ id: "a", distanceAlongCorridorM: 300, signalPlan: null, confidence: 0 }),
      makeIntersection({ id: "b", distanceAlongCorridorM: 700, signalPlan: knownGreenPlan, confidence: 0.9 }),
    ]);
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: mphToMps(20) };
    const result = optimize(corridor, vehicle);
    expect(result.recommendation.isGreenWave).toBe(false);
    expect(result.recommendation.reason).toMatch(/LIMITED SIGNAL DATA|LEARNING ROUTE/);
  });

  it("labels a fully-unknown route as LEARNING ROUTE", () => {
    const corridor = makeCorridor([
      makeIntersection({ id: "a", distanceAlongCorridorM: 300, signalPlan: null, confidence: 0 }),
      makeIntersection({ id: "b", distanceAlongCorridorM: 700, signalPlan: null, confidence: 0 }),
    ]);
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: mphToMps(20) };
    const result = optimize(corridor, vehicle);
    expect(result.recommendation.reason).toBe("LEARNING ROUTE");
  });

  it("never exceeds the speed limit even when every signal is unknown", () => {
    const corridor = makeCorridor(
      [makeIntersection({ distanceAlongCorridorM: 400, signalPlan: null, confidence: 0 })],
      25,
    );
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: mphToMps(30) }; // already-illegal input speed
    const result = optimize(corridor, vehicle);
    expect(result.recommendation.targetSpeedMps).toBeLessThanOrEqual(mphToMps(25) + 1e-6);
  });

  it("still optimizes against a known downstream signal when the immediate next one is unknown", () => {
    const redPlan = { cycleSec: 90, greenSec: 2, yellowSec: 1, redSec: 87, offsetSec: 0 }; // effectively always red
    const corridor = makeCorridor([
      makeIntersection({ id: "a", distanceAlongCorridorM: 200, signalPlan: null, confidence: 0 }),
      makeIntersection({ id: "b", distanceAlongCorridorM: 900, signalPlan: redPlan, confidence: 0.9 }),
    ]);
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: mphToMps(25) };
    const result = optimize(corridor, vehicle, DEFAULT_CONSTRAINTS, null, true);
    // The known-red downstream signal should still influence the choice away from full speed.
    const fullSpeedCandidate = result.candidates.find((c) => Math.abs(c.speedMps - mphToMps(25)) < 0.1);
    expect(fullSpeedCandidate?.stopsRequired).toBeGreaterThanOrEqual(1);
  });

  it("does not pin the recommendation at 0 mph on the very first GPS fix (speed 0, all signals unknown)", () => {
    // Regression: the low-confidence conservative clamp used to be
    // Math.min(best, vehicle.speedMps, limit) unconditionally, which locked
    // the target at 0 forever whenever the first tick's derived speed was 0
    // (no prior GPS fix to diff against) combined with low-confidence
    // (here: zero-confidence unknown) signals.
    const corridor = makeCorridor([
      makeIntersection({ id: "a", distanceAlongCorridorM: 100, signalPlan: null, confidence: 0 }),
      makeIntersection({ id: "b", distanceAlongCorridorM: 200, signalPlan: null, confidence: 0 }),
    ]);
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: 0 };
    const result = optimize(corridor, vehicle);
    expect(result.recommendation.targetSpeedMps).toBeGreaterThan(0);
    expect(result.recommendation.targetSpeedMps).toBeLessThanOrEqual(corridor.speedLimitMps + 1e-6);
  });
});

describe("optimize: consumes SignalTimingEstimate (Signal Intelligence) for probabilistic GLOSA", () => {
  it("prefers a robustly-green arrival over holding a faster speed that arrives too early, once given a timing estimate", () => {
    // No deterministic plan at all (signalPlan: null) — without a
    // SignalTimingEstimate, this intersection is scoring-neutral and the
    // optimizer should just hold close to the current, faster speed.
    const corridor = makeCorridor([makeIntersection({ distanceAlongCorridorM: 300, signalPlan: null, confidence: 0 })], 30);
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: mphToMps(28) };

    const baseline = optimize(corridor, vehicle);
    expect(mpsToMph(baseline.recommendation.targetSpeedMps)).toBeGreaterThan(26); // holds near current/legal-max speed

    // A green window [25s, 35s] from now: ~28-30mph arrives too early (red);
    // ~20mph arrives comfortably inside the window with real margin.
    const estimate = {
      source: "OFFICIAL_LIVE" as const,
      phase: "RED" as const,
      minEndTime: 25_000,
      likelyEndTime: 25_000,
      maxEndTime: 25_000,
      nextGreenStart: 25_000,
      nextGreenEnd: 35_000,
      confidence: 0.97,
      observedAt: 0,
      freshnessMs: 0,
    };
    const signalEstimates = new Map([[corridor.intersections[0].id, estimate]]);

    const withEstimate = optimize(corridor, vehicle, DEFAULT_CONSTRAINTS, null, false, signalEstimates);
    expect(mpsToMph(withEstimate.recommendation.targetSpeedMps)).toBeLessThan(24); // materially slower, to land inside the predicted green window
    expect(withEstimate.recommendation.targetSpeedMps).toBeLessThanOrEqual(corridor.speedLimitMps + 1e-6);
  });

  it("has zero effect when no estimate is supplied for any upcoming intersection (backward compatible)", () => {
    const corridor = makeCorridor([makeIntersection({ distanceAlongCorridorM: 300, signalPlan: null, confidence: 0 })], 30);
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: mphToMps(28) };
    const withoutMap = optimize(corridor, vehicle);
    const withEmptyMap = optimize(corridor, vehicle, DEFAULT_CONSTRAINTS, null, false, new Map());
    expect(withEmptyMap.recommendation.targetSpeedMps).toBe(withoutMap.recommendation.targetSpeedMps);
  });
});
