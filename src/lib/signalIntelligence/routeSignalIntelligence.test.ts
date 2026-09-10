import { describe, expect, it } from "vitest";
import { buildRouteSignalIntelligence, clampResultConfidence } from "./routeSignalIntelligence";
import { SignalIntelligenceEngine, type SignalIntelligenceResult } from "./SignalIntelligenceEngine";
import { buildMockDiscoveredSignals, buildMockRoute } from "@/lib/routing/mockProviders";
import type { SignalApproach, SignalIntelligenceProvider, SignalTimingEvidence } from "@/lib/types";

describe("clampResultConfidence", () => {
  it("lowers confidence (and tier) to the ceiling when the ceiling is stricter", () => {
    const result: SignalIntelligenceResult = {
      estimate: {
        source: "LEARNED",
        phase: "RED",
        minEndTime: 1000,
        likelyEndTime: 1000,
        maxEndTime: 1000,
        nextGreenStart: 1000,
        nextGreenEnd: 2000,
        confidence: 0.97,
        observedAt: 0,
        freshnessMs: 0,
      },
      tier: "HIGH",
      preciseCountdownAllowed: true,
      glosaAllowed: true,
    };
    const clamped = clampResultConfidence(result, 0.4);
    expect(clamped.estimate?.confidence).toBe(0.4);
    expect(clamped.tier).toBe("UNAVAILABLE");
    expect(clamped.preciseCountdownAllowed).toBe(false);
  });

  it("leaves an UNAVAILABLE (no-estimate) result untouched", () => {
    const result: SignalIntelligenceResult = { estimate: null, tier: "UNAVAILABLE", preciseCountdownAllowed: false, glosaAllowed: false };
    expect(clampResultConfidence(result, 0.9)).toBe(result);
  });

  it("does not raise confidence above what the evidence already reported", () => {
    const result: SignalIntelligenceResult = {
      estimate: {
        source: "MANUAL",
        phase: "GREEN",
        minEndTime: null,
        likelyEndTime: null,
        maxEndTime: null,
        nextGreenStart: null,
        nextGreenEnd: null,
        confidence: 0.5,
        observedAt: 0,
        freshnessMs: 0,
      },
      tier: "UNAVAILABLE",
      preciseCountdownAllowed: false,
      glosaAllowed: false,
    };
    expect(clampResultConfidence(result, 0.99).estimate?.confidence).toBe(0.5);
  });
});

class FixedProvider implements SignalIntelligenceProvider {
  constructor(private readonly evidence: SignalTimingEvidence | null) {}
  async getTiming(): Promise<SignalTimingEvidence | null> {
    return this.evidence;
  }
}

describe("buildRouteSignalIntelligence", () => {
  it("produces one result per discovered signal, keyed by signal id", async () => {
    const route = buildMockRoute();
    const signals = buildMockDiscoveredSignals(route);
    const engine = new SignalIntelligenceEngine([new FixedProvider(null)]);
    const results = await buildRouteSignalIntelligence(route, signals, engine, 0);
    expect(results.size).toBe(signals.length);
    for (const signal of signals) {
      expect(results.has(signal.id)).toBe(true);
    }
  });

  it("caps confidence for a signal with low direction-applicability confidence, even with strong evidence", async () => {
    const route = buildMockRoute();
    const signals = buildMockDiscoveredSignals(route);
    const marginal = signals.find((s) => s.directionConfidence < 0.5)!;
    expect(marginal).toBeDefined();

    const evidence: SignalTimingEvidence = {
      source: "LEARNED",
      phase: "GREEN",
      minEndTime: null,
      likelyEndTime: null,
      maxEndTime: null,
      nextGreenStart: null,
      nextGreenEnd: null,
      confidence: 0.99,
      observedAt: 0,
    };
    const engine = new SignalIntelligenceEngine([new FixedProvider(evidence)]);
    const results = await buildRouteSignalIntelligence(route, signals, engine, 0);
    const result = results.get(marginal.id)!;
    expect(result.estimate?.confidence).toBeLessThanOrEqual(marginal.directionConfidence);
  });

  it("resolves a distinct approach per signal that reflects the route's movement there", async () => {
    const route = buildMockRoute();
    const signals = buildMockDiscoveredSignals(route);
    const seenApproaches: SignalApproach[] = [];
    class RecordingProvider implements SignalIntelligenceProvider {
      async getTiming(approach: SignalApproach): Promise<SignalTimingEvidence | null> {
        seenApproaches.push(approach);
        return null;
      }
    }
    const engine = new SignalIntelligenceEngine([new RecordingProvider()]);
    await buildRouteSignalIntelligence(route, signals, engine, 0);
    expect(seenApproaches).toHaveLength(signals.length);
    expect(seenApproaches.every((a) => a.maneuver === "THROUGH")).toBe(true); // the mock route has no turns
  });
});
