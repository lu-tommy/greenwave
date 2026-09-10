import { describe, expect, it } from "vitest";
import { LegacyTimingProviderAdapter, predictionToEvidence } from "./legacyAdapter";
import { StaticSignalTimingProvider } from "@/lib/providers/StaticSignalTimingProvider";
import type { Corridor, SignalApproach, SignalPrediction } from "@/lib/types";

describe("predictionToEvidence", () => {
  it("returns null for an unknown-phase prediction (no evidence, not a guess)", () => {
    const prediction: SignalPrediction = {
      intersectionId: "a",
      phase: "unknown",
      secondsRemainingInPhase: null,
      nextTransitionAt: null,
      nextGreenAt: null,
      nextGreenEndsAt: null,
      confidence: 0,
    };
    expect(predictionToEvidence(prediction, "MANUAL", 1000)).toBeNull();
  });

  it("maps a known phase and carries the deterministic window + confidence through", () => {
    const prediction: SignalPrediction = {
      intersectionId: "a",
      phase: "red",
      secondsRemainingInPhase: 12,
      nextTransitionAt: 5000,
      nextGreenAt: 8000,
      nextGreenEndsAt: 20_000,
      confidence: 0.9,
    };
    const evidence = predictionToEvidence(prediction, "LEARNED", 1000);
    expect(evidence).toEqual({
      source: "LEARNED",
      phase: "RED",
      minEndTime: 8000,
      likelyEndTime: 8000,
      maxEndTime: 8000,
      nextGreenStart: 8000,
      nextGreenEnd: 20_000,
      confidence: 0.9,
      observedAt: 1000,
    });
  });

  it("uses nextGreenAt (not nextTransitionAt) for the green window during YELLOW, where they diverge", () => {
    // Yellow's next transition is to RED, one full red-phase short of green —
    // the Time-to-Green window must never collapse to "time to red".
    const prediction: SignalPrediction = {
      intersectionId: "a",
      phase: "yellow",
      secondsRemainingInPhase: 2,
      nextTransitionAt: 2000, // end of yellow -> red
      nextGreenAt: 31_000, // end of yellow + full red phase
      nextGreenEndsAt: 60_000,
      confidence: 0.9,
    };
    const evidence = predictionToEvidence(prediction, "LEARNED", 0);
    expect(evidence?.minEndTime).toBe(31_000);
    expect(evidence?.likelyEndTime).toBe(31_000);
    expect(evidence?.maxEndTime).toBe(31_000);
    expect(evidence?.minEndTime).not.toBe(prediction.nextTransitionAt);
  });
});

describe("LegacyTimingProviderAdapter", () => {
  it("wraps an existing SignalTimingProvider and labels evidence with the given source", async () => {
    const plan = { cycleSec: 60, greenSec: 28, yellowSec: 3, redSec: 29, offsetSec: 0 };
    const corridor: Corridor = {
      id: "c",
      name: "c",
      direction: "N/A",
      speedLimitMps: 10,
      polyline: [],
      intersections: [{ id: "sig-1", name: "x", lat: 0, lng: 0, distanceAlongCorridorM: 0, signalPlan: plan, confidence: 0.85 }],
      dataSourceLabel: "SIMULATED SIGNAL DATA",
    };
    const adapter = new LegacyTimingProviderAdapter(new StaticSignalTimingProvider(corridor), "HISTORICAL");
    const approach: SignalApproach = { signalId: "sig-1", approachId: "sig-1:THROUGH", direction: null, maneuver: "THROUGH" };

    const evidence = await adapter.getTiming(approach, 0);
    expect(evidence?.source).toBe("HISTORICAL");
    expect(evidence?.phase).toBe("GREEN");
    expect(evidence?.confidence).toBe(0.85);
  });

  it("returns null when the wrapped provider has no plan for the signal", async () => {
    const corridor: Corridor = {
      id: "c",
      name: "c",
      direction: "N/A",
      speedLimitMps: 10,
      polyline: [],
      intersections: [],
      dataSourceLabel: "SIMULATED SIGNAL DATA",
    };
    const adapter = new LegacyTimingProviderAdapter(new StaticSignalTimingProvider(corridor), "MANUAL");
    const approach: SignalApproach = { signalId: "missing", approachId: "missing:THROUGH", direction: null, maneuver: "THROUGH" };
    expect(await adapter.getTiming(approach, 0)).toBeNull();
  });
});
