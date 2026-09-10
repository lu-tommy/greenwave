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
