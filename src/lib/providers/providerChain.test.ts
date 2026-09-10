import { beforeEach, describe, expect, it } from "vitest";
import { LearnedSignalTimingProvider } from "./LearnedSignalTimingProvider";
import { ChainedSignalTimingProvider } from "./ChainedSignalTimingProvider";
import { StaticSignalTimingProvider } from "./StaticSignalTimingProvider";
import { clearAllSignalKnowledge, putSignalKnowledge } from "@/lib/storage/signalKnowledgeStore";
import type { Corridor, SignalTimingProvider } from "@/lib/types";

beforeEach(async () => {
  await clearAllSignalKnowledge();
});

describe("LearnedSignalTimingProvider", () => {
  it("returns unknown (plan: null, confidence: 0) for a signal with no learned model", async () => {
    const provider = new LearnedSignalTimingProvider();
    const result = await provider.getSignalPlan("osm:node:never-seen");
    expect(result.plan).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("returns the learned plan and confidence for a signal with a model", async () => {
    await putSignalKnowledge({
      signalId: "osm:node:1",
      lat: 0,
      lng: 0,
      direction: 90,
      timingModel: {
        cycleSec: 60,
        greenSec: 28,
        yellowSec: 3,
        redSec: 29,
        offsetSec: 5,
        confidence: 0.6,
        sampleCount: 6,
        updatedAt: Date.now(),
      },
      observationCount: 6,
      firstObservedAt: 0,
      lastObservedAt: Date.now(),
    });

    const provider = new LearnedSignalTimingProvider();
    const result = await provider.getSignalPlan("osm:node:1");
    expect(result.plan?.cycleSec).toBe(60);
    expect(result.confidence).toBeCloseTo(0.6, 1);
  });

  it("getSignalPrediction reports 'unknown' phase for a signal with no model", async () => {
    const provider = new LearnedSignalTimingProvider();
    const prediction = await provider.getSignalPrediction("osm:node:never-seen", Date.now());
    expect(prediction.phase).toBe("unknown");
  });
});

class MockProvider implements SignalTimingProvider {
  constructor(private readonly plans: Record<string, { cycleSec: number; greenSec: number; yellowSec: number; redSec: number; offsetSec: number } | null>) {}
  async getSignalPlan(id: string) {
    const plan = this.plans[id] ?? null;
    return { plan, confidence: plan ? 0.7 : 0 };
  }
  async getSignalPrediction(id: string) {
    return {
      intersectionId: id,
      phase: "unknown" as const,
      secondsRemainingInPhase: null,
      nextTransitionAt: null,
      nextGreenAt: null,
      nextGreenEndsAt: null,
      confidence: 0,
    };
  }
}

describe("ChainedSignalTimingProvider", () => {
  it("uses the first provider in the chain that knows the signal", async () => {
    const first = new MockProvider({ a: { cycleSec: 60, greenSec: 28, yellowSec: 3, redSec: 29, offsetSec: 0 } });
    const second = new MockProvider({ a: { cycleSec: 90, greenSec: 40, yellowSec: 4, redSec: 46, offsetSec: 0 } });
    const chain = new ChainedSignalTimingProvider([first, second]);
    const result = await chain.getSignalPlan("a");
    expect(result.plan?.cycleSec).toBe(60);
  });

  it("falls through to a later provider when an earlier one does not know the signal", async () => {
    const first = new MockProvider({});
    const second = new MockProvider({ a: { cycleSec: 90, greenSec: 40, yellowSec: 4, redSec: 46, offsetSec: 0 } });
    const chain = new ChainedSignalTimingProvider([first, second]);
    const result = await chain.getSignalPlan("a");
    expect(result.plan?.cycleSec).toBe(90);
  });

  it("returns unknown when no provider in the chain knows the signal", async () => {
    const chain = new ChainedSignalTimingProvider([new MockProvider({}), new MockProvider({})]);
    const result = await chain.getSignalPlan("a");
    expect(result.plan).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("chains a real StaticSignalTimingProvider with a mock fallback", async () => {
    const emptyCorridor: Corridor = {
      id: "c",
      name: "c",
      direction: "N/A",
      speedLimitMps: 10,
      polyline: [],
      intersections: [],
      dataSourceLabel: "SIMULATED SIGNAL DATA",
    };
    const staticProvider = new StaticSignalTimingProvider(emptyCorridor);
    const fallback = new MockProvider({ b: { cycleSec: 60, greenSec: 28, yellowSec: 3, redSec: 29, offsetSec: 0 } });
    const chain = new ChainedSignalTimingProvider([staticProvider, fallback]);
    const result = await chain.getSignalPlan("b");
    expect(result.plan?.cycleSec).toBe(60);
  });
});
