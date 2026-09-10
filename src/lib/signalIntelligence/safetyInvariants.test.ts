import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { optimize } from "@/lib/optimizer/optimizer";
import { mphToMps } from "@/lib/geo/units";
import { instructionLabel } from "@/components/ui/instructionLabel";
import { computeTimeToGreen } from "./timeToGreen";
import { SignalIntelligenceEngine } from "./SignalIntelligenceEngine";
import { SpatMessageStore, SpatSignalTimingProvider } from "./spatIngestion";
import type { Corridor, DriveInstruction, Intersection, SignalApproach, VehicleState } from "@/lib/types";

/**
 * One file, one test per hard safety invariant from the project spec —
 * intentionally not deduplicated against coverage elsewhere: this file is
 * meant to be read top-to-bottom as an audit checklist, each assertion
 * traceable to a specific numbered rule.
 */

function makeIntersection(overrides: Partial<Intersection>): Intersection {
  return {
    id: "int",
    name: "Test St",
    lat: 0,
    lng: 0,
    distanceAlongCorridorM: 300,
    signalPlan: { cycleSec: 60, greenSec: 28, yellowSec: 3, redSec: 29, offsetSec: 0 },
    confidence: 0.95,
    ...overrides,
  };
}

function makeCorridor(intersections: Intersection[], speedLimitMph = 25): Corridor {
  return {
    id: "c",
    name: "c",
    direction: "Eastbound",
    speedLimitMps: mphToMps(speedLimitMph),
    polyline: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }],
    intersections,
    dataSourceLabel: "SIMULATED SIGNAL DATA",
  };
}

describe("Safety invariant 1: recommendedSpeed <= speedLimit", () => {
  it("holds even when every candidate leg is a known green and current speed already exceeds the limit", () => {
    const corridor = makeCorridor([makeIntersection({ signalPlan: { cycleSec: 60, greenSec: 55, yellowSec: 2, redSec: 3, offsetSec: 0 } })], 25);
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: mphToMps(40) };
    const result = optimize(corridor, vehicle);
    expect(result.recommendation.targetSpeedMps).toBeLessThanOrEqual(corridor.speedLimitMps + 1e-6);
  });
});

describe("Safety invariant 2: no precise countdown unless confidence permits it (HIGH tier only)", () => {
  it("an ESTIMATED-tier signal never produces a COUNTDOWN state", async () => {
    const engine = new SignalIntelligenceEngine([
      {
        async getTiming() {
          return {
            source: "LEARNED",
            phase: "RED",
            minEndTime: 17_000,
            likelyEndTime: 17_000,
            maxEndTime: 17_000,
            nextGreenStart: 17_000,
            nextGreenEnd: 40_000,
            confidence: 0.85, // ESTIMATED, not HIGH
            observedAt: 0,
          };
        },
      },
    ]);
    const approach: SignalApproach = { signalId: "a", approachId: "a:THROUGH", direction: 0, maneuver: "THROUGH" };
    const result = await engine.evaluate(approach, 0);
    expect(result.tier).toBe("ESTIMATED");
    const ttg = computeTimeToGreen(result, 0, 0);
    expect(ttg.status).not.toBe("COUNTDOWN");
    expect(ttg.status).toBe("ESTIMATED_RANGE");
  });
});

describe("Safety invariant 3: stale live data can never remain authoritative", () => {
  it("an OFFICIAL_LIVE message past its hard-expiry window is excluded from fusion entirely", async () => {
    const store = new SpatMessageStore();
    store.ingest({
      intersectionId: "a",
      timestamp: 0,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "GREEN", minEndTime: 30_000 }] }],
    });
    const engine = new SignalIntelligenceEngine([new SpatSignalTimingProvider(store)]);
    const approach: SignalApproach = { signalId: "a", approachId: "a:THROUGH", direction: 0, maneuver: "THROUGH" };
    const result = await engine.evaluate(approach, 60_000); // 60s later, far past OFFICIAL_LIVE's 8s hard expiry
    expect(result.estimate).toBeNull();
    expect(result.tier).toBe("UNAVAILABLE");
  });
});

describe("Safety invariants 4 & 5: unknown signal is never treated as red or green", () => {
  it("never appears as 'green' in the recommendation's upcoming forecast", () => {
    const corridor = makeCorridor([makeIntersection({ signalPlan: null, confidence: 0 })]);
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: mphToMps(20) };
    const result = optimize(corridor, vehicle);
    const phase = result.recommendation.upcoming[0]?.predictedPhaseAtArrival;
    expect(phase).not.toBe("green");
    expect(phase).not.toBe("red");
    expect(phase).toBe("unknown");
  });

  it("never triggers PREPARE_TO_STOP (the 'confidently red' instruction) for an unknown signal", () => {
    const corridor = makeCorridor([makeIntersection({ distanceAlongCorridorM: 30, signalPlan: null, confidence: 0 })]);
    const vehicle: VehicleState = { timestamp: 0, positionM: 0, speedMps: mphToMps(25) };
    const result = optimize(corridor, vehicle);
    expect(result.recommendation.instruction).not.toBe("PREPARE_TO_STOP");
  });
});

describe("Safety invariant 6: a left-turn route never silently substitutes through-phase timing", () => {
  it("returns no evidence for a LEFT approach when only a THROUGH signal group is known", async () => {
    const store = new SpatMessageStore();
    store.ingest({
      intersectionId: "a",
      timestamp: 0,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "GREEN", minEndTime: 30_000 }] }],
    });
    const provider = new SpatSignalTimingProvider(store);
    const leftApproach: SignalApproach = { signalId: "a", approachId: "a:LEFT", direction: 0, maneuver: "LEFT" };
    expect(await provider.getTiming(leftApproach, 0)).toBeNull();
  });
});

describe("Safety invariant 7: low approach-applicability confidence excludes a signal from precise advice", () => {
  it("a discovered signal below the direction-confidence floor is dropped from the optimized corridor entirely", async () => {
    const { buildRouteCorridor } = await import("@/lib/routing/routeCorridor");
    const { buildMockRoute } = await import("@/lib/routing/mockProviders");
    const { StaticSignalTimingProvider } = await import("@/lib/providers/StaticSignalTimingProvider");
    const route = buildMockRoute();
    const lowConfidenceSignal = {
      id: "osm:node:marginal",
      lat: 0,
      lng: 0,
      distanceAlongRouteM: 100,
      perpendicularDistanceM: 25,
      routeHeadingDeg: 90,
      directionConfidence: 0.1, // below MIN_DIRECTION_CONFIDENCE (0.3)
      firstSeen: 0,
      lastSeen: 0,
    };
    const emptyCorridor: Corridor = { id: "e", name: "e", direction: "N/A", speedLimitMps: 10, polyline: [], intersections: [], dataSourceLabel: "SIMULATED SIGNAL DATA" };
    const corridor = await buildRouteCorridor(route, [lowConfidenceSignal], new StaticSignalTimingProvider(emptyCorridor));
    expect(corridor.intersections.find((i) => i.id === "osm:node:marginal")).toBeUndefined();
  });
});

describe("Safety invariant 8: never display 'GO'", () => {
  it("no drive-instruction label uses gamified/urgent language ('GO', 'BEAT', 'SPEED UP', '!')", () => {
    const instructions: DriveInstruction[] = ["HOLD", "COAST", "SLOW", "ACCELERATE_GENTLY", "PREPARE_TO_STOP"];
    for (const instruction of instructions) {
      const label = instructionLabel(instruction, mphToMps(21));
      expect(label).not.toMatch(/\bGO\b/);
      expect(label).not.toMatch(/BEAT/i);
      expect(label).not.toMatch(/SPEED UP/i);
      expect(label).not.toContain("!");
    }
  });

  it("the Time-to-Green display's static copy contains no 'GO'/urgent language", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../components/drive/TimeToGreenDisplay.tsx"), "utf-8");
    expect(source).not.toMatch(/>\s*GO\s*</);
    expect(source).not.toMatch(/BEAT THE LIGHT/i);
  });
});

describe("Safety invariant 9: near the predicted transition, WATCH SIGNAL — never count to zero", () => {
  it("a countdown approaching the watch threshold switches to WATCH_SIGNAL, never reaches 0", () => {
    for (const secondsRemaining of [6, 5.5, 5, 4.9, 3, 1, 0.5]) {
      const estimate = {
        source: "OFFICIAL_LIVE" as const,
        phase: "RED" as const,
        minEndTime: secondsRemaining * 1000,
        likelyEndTime: secondsRemaining * 1000,
        maxEndTime: secondsRemaining * 1000,
        nextGreenStart: secondsRemaining * 1000,
        nextGreenEnd: secondsRemaining * 1000 + 20_000,
        confidence: 0.99,
        observedAt: 0,
        freshnessMs: 0,
      };
      const result = { estimate, tier: "HIGH" as const, preciseCountdownAllowed: true, glosaAllowed: true };
      const state = computeTimeToGreen(result, 0, 0);
      if (secondsRemaining <= 5) {
        expect(state.status).toBe("WATCH_SIGNAL");
      }
      if (state.status === "COUNTDOWN") {
        expect(state.secondsToGreen).toBeGreaterThan(0);
      }
    }
  });
});

describe("Safety invariant 10: all guidance remains advisory", () => {
  it("the safety disclaimer component renders the required advisory text", async () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../components/ui/SafetyDisclaimer.tsx"), "utf-8");
    expect(source).toMatch(/Advisory only.*obey traffic laws/i);
  });

  it("the active drive screen always renders the safety disclaimer", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../components/drive/RouteDriveActive.tsx"), "utf-8");
    expect(source).toContain("SafetyDisclaimer");
  });
});
