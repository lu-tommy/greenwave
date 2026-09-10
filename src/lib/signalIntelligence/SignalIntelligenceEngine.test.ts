import { describe, expect, it } from "vitest";
import { SignalIntelligenceEngine } from "./SignalIntelligenceEngine";
import { SpatMessageStore, SpatSignalTimingProvider } from "./spatIngestion";
import type { SignalApproach, SignalIntelligenceProvider, SignalTimingEvidence } from "@/lib/types";

const APPROACH: SignalApproach = { signalId: "osm:node:1", approachId: "osm:node:1:THROUGH", direction: 90, maneuver: "THROUGH" };

class FixedEvidenceProvider implements SignalIntelligenceProvider {
  constructor(private readonly evidence: SignalTimingEvidence | null) {}
  async getTiming(): Promise<SignalTimingEvidence | null> {
    return this.evidence;
  }
}

describe("SignalIntelligenceEngine", () => {
  it("returns UNAVAILABLE with no estimate when no provider has evidence", async () => {
    const engine = new SignalIntelligenceEngine([new FixedEvidenceProvider(null)]);
    const result = await engine.evaluate(APPROACH, 1000);
    expect(result.tier).toBe("UNAVAILABLE");
    expect(result.estimate).toBeNull();
    expect(result.preciseCountdownAllowed).toBe(false);
    expect(result.glosaAllowed).toBe(false);
  });

  it("fresh live SPaT at .99 confidence allows a precise Time-to-Green countdown", async () => {
    const store = new SpatMessageStore();
    store.ingest({
      intersectionId: "osm:node:1",
      timestamp: 1000,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "RED", minEndTime: 19_000, likelyEndTime: 18_000 }] }],
    });
    const engine = new SignalIntelligenceEngine([new SpatSignalTimingProvider(store)]);
    const result = await engine.evaluate(APPROACH, 1000); // evaluated right when the message arrived — fresh
    expect(result.tier).toBe("HIGH");
    expect(result.preciseCountdownAllowed).toBe(true);
    expect(result.estimate?.likelyEndTime).toBe(18_000);
  });

  it("the same live message, evaluated after its freshness window expires, immediately loses the countdown", async () => {
    const store = new SpatMessageStore();
    store.ingest({
      intersectionId: "osm:node:1",
      timestamp: 1000,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "RED", minEndTime: 19_000, likelyEndTime: 18_000 }] }],
    });
    const engine = new SignalIntelligenceEngine([new SpatSignalTimingProvider(store)]);
    const result = await engine.evaluate(APPROACH, 1000 + 20_000); // 20s later — well past OFFICIAL_LIVE's 8s hard expiry
    expect(result.tier).toBe("UNAVAILABLE");
    expect(result.estimate).toBeNull();
  });

  it("a learned model at 0.87 confidence is ESTIMATED, not HIGH — no exact countdown allowed", async () => {
    const evidence: SignalTimingEvidence = {
      source: "LEARNED",
      phase: "RED",
      minEndTime: 19_000,
      likelyEndTime: 18_000,
      maxEndTime: 20_000,
      nextGreenStart: 18_000,
      nextGreenEnd: 40_000,
      confidence: 0.87,
      observedAt: 1000,
    };
    const engine = new SignalIntelligenceEngine([new FixedEvidenceProvider(evidence)]);
    const result = await engine.evaluate(APPROACH, 1000);
    expect(result.tier).toBe("ESTIMATED");
    expect(result.preciseCountdownAllowed).toBe(false);
    expect(result.glosaAllowed).toBe(true);
  });

  it("prefers fresh live evidence over a merely high-confidence learned model", async () => {
    const learned: SignalTimingEvidence = {
      source: "LEARNED",
      phase: "RED",
      minEndTime: 19_000,
      likelyEndTime: 18_000,
      maxEndTime: 20_000,
      nextGreenStart: 18_000,
      nextGreenEnd: 40_000,
      confidence: 0.9,
      observedAt: 1000,
    };
    const store = new SpatMessageStore();
    store.ingest({
      intersectionId: "osm:node:1",
      timestamp: 1000,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "RED", minEndTime: 15_000, likelyEndTime: 14_000 }] }],
    });
    const engine = new SignalIntelligenceEngine([new FixedEvidenceProvider(learned), new SpatSignalTimingProvider(store)]);
    const result = await engine.evaluate(APPROACH, 1000);
    expect(result.estimate?.source).toBe("OFFICIAL_LIVE");
  });

  it("falls back to a lower-precedence source once the higher one has expired", async () => {
    const learned: SignalTimingEvidence = {
      source: "LEARNED",
      phase: "RED",
      minEndTime: 40_000,
      likelyEndTime: 38_000,
      maxEndTime: 42_000,
      nextGreenStart: 38_000,
      nextGreenEnd: 60_000,
      confidence: 0.85,
      observedAt: 1000,
    };
    const store = new SpatMessageStore();
    store.ingest({
      intersectionId: "osm:node:1",
      timestamp: 1000,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "RED", minEndTime: 15_000, likelyEndTime: 14_000 }] }],
    });
    const engine = new SignalIntelligenceEngine([new FixedEvidenceProvider(learned), new SpatSignalTimingProvider(store)]);
    const result = await engine.evaluate(APPROACH, 1000 + 20_000); // live has expired; learned (30-day decay) has not
    expect(result.estimate?.source).toBe("LEARNED");
    expect(result.tier).toBe("ESTIMATED"); // 0.85 confidence — below the 0.95 HIGH threshold
  });

  it("lets a deliberately high-confidence manual calibration win a near-tie against learned evidence", async () => {
    const learned: SignalTimingEvidence = {
      source: "LEARNED",
      phase: "RED",
      minEndTime: 19_000,
      likelyEndTime: 18_000,
      maxEndTime: 20_000,
      nextGreenStart: 18_000,
      nextGreenEnd: 40_000,
      confidence: 0.75,
      observedAt: 1000,
    };
    const manual: SignalTimingEvidence = { ...learned, source: "MANUAL", confidence: 0.99 };
    const engine = new SignalIntelligenceEngine([new FixedEvidenceProvider(learned), new FixedEvidenceProvider(manual)]);
    const result = await engine.evaluate(APPROACH, 1000);
    expect(result.estimate?.source).toBe("MANUAL");
    expect(result.tier).toBe("HIGH");
  });

  it("on a near-tie in effective confidence, prefers the higher-precedence source", async () => {
    const learned: SignalTimingEvidence = {
      source: "LEARNED",
      phase: "RED",
      minEndTime: 19_000,
      likelyEndTime: 18_000,
      maxEndTime: 20_000,
      nextGreenStart: 18_000,
      nextGreenEnd: 40_000,
      confidence: 0.86,
      observedAt: 1000,
    };
    const manual: SignalTimingEvidence = { ...learned, source: "MANUAL", confidence: 0.85 }; // within the tie-break margin
    const engine = new SignalIntelligenceEngine([new FixedEvidenceProvider(learned), new FixedEvidenceProvider(manual)]);
    const result = await engine.evaluate(APPROACH, 1000);
    expect(result.estimate?.source).toBe("LEARNED"); // higher source rank than MANUAL
  });
});
