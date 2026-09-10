import { describe, expect, it } from "vitest";
import { classifyArrivalProbability, estimateArrivalUncertaintySec, greenMarginSec, robustGreenScore } from "./glosaUncertainty";
import type { SignalTimingEstimate } from "@/lib/types";

function makeEstimate(overrides: Partial<SignalTimingEstimate>): SignalTimingEstimate {
  return {
    source: "LEARNED",
    phase: "RED",
    minEndTime: null,
    likelyEndTime: null,
    maxEndTime: null,
    nextGreenStart: 20_000,
    nextGreenEnd: 40_000, // a 20-second-wide green window
    confidence: 0.9,
    observedAt: 0,
    freshnessMs: 0,
    ...overrides,
  };
}

describe("estimateArrivalUncertaintySec", () => {
  it("grows with how far out the ETA is", () => {
    const near = estimateArrivalUncertaintySec(10);
    const far = estimateArrivalUncertaintySec(200);
    expect(far).toBeGreaterThan(near);
  });

  it("never goes below the minimum floor, even for a near-zero ETA", () => {
    expect(estimateArrivalUncertaintySec(0.1)).toBeGreaterThanOrEqual(1);
  });

  it("is capped so an extremely long ETA doesn't produce an absurd uncertainty", () => {
    expect(estimateArrivalUncertaintySec(10_000)).toBeLessThanOrEqual(20);
  });
});

describe("classifyArrivalProbability", () => {
  const estimate = makeEstimate({});

  it("DEFINITELY_GREEN when the whole uncertainty interval sits inside the window", () => {
    expect(classifyArrivalProbability(estimate, 30_000, 2)).toBe("DEFINITELY_GREEN");
  });

  it("DEFINITELY_RED when the whole uncertainty interval sits outside the window", () => {
    expect(classifyArrivalProbability(estimate, 5000, 2)).toBe("DEFINITELY_RED");
  });

  it("UNCERTAIN when the arrival is right at the edge of the window with meaningful uncertainty", () => {
    expect(classifyArrivalProbability(estimate, 20_000, 8)).toBe("UNCERTAIN");
  });

  it("LIKELY_GREEN when most, but not all, of the uncertainty interval is inside the window", () => {
    // arrival at 22s with ±3s uncertainty (19-25s): 5 of 6 seconds fall inside [20,40] (~83%)
    expect(classifyArrivalProbability(estimate, 22_000, 3)).toBe("LIKELY_GREEN");
  });

  it("returns UNCERTAIN when there is no usable window at all", () => {
    const noWindow = makeEstimate({ nextGreenStart: null, nextGreenEnd: null });
    expect(classifyArrivalProbability(noWindow, 30_000, 2)).toBe("UNCERTAIN");
  });

  it("treats an already-green phase as an open-ended-on-the-near-side window", () => {
    const alreadyGreen = makeEstimate({ phase: "GREEN", likelyEndTime: 40_000, nextGreenStart: null, nextGreenEnd: null });
    expect(classifyArrivalProbability(alreadyGreen, 10_000, 2)).toBe("DEFINITELY_GREEN");
  });
});

describe("robustGreenScore: prefers a wide margin over an exact-but-fragile prediction", () => {
  it("scores a mid-window arrival with a wide margin higher than an edge-of-window arrival needing an exact prediction", () => {
    const estimate = makeEstimate({}); // green window [20s, 40s]
    // Candidate A: arrives right at the edge of green (20.5s), needs the prediction to be exact within ±0.5s.
    const scoreA = robustGreenScore(estimate, 20_500, 0.5);
    // Candidate B: arrives in the middle of the window (30s) with generous ±4s uncertainty.
    const scoreB = robustGreenScore(estimate, 30_000, 4);
    expect(scoreB).toBeGreaterThan(scoreA);
  });

  it("scores DEFINITELY_RED lower than DEFINITELY_GREEN", () => {
    const estimate = makeEstimate({});
    expect(robustGreenScore(estimate, 30_000, 2)).toBeGreaterThan(robustGreenScore(estimate, 5000, 2));
  });
});

describe("greenMarginSec", () => {
  it("is positive and reflects distance to the nearer edge when inside the window", () => {
    const estimate = makeEstimate({}); // [20s, 40s]
    expect(greenMarginSec(estimate, 25_000)).toBeCloseTo(5, 5); // 5s from start, 15s from end -> min is 5
  });

  it("is negative when outside the window", () => {
    const estimate = makeEstimate({});
    expect(greenMarginSec(estimate, 10_000)!).toBeLessThan(0);
  });
});
