import { describe, expect, it } from "vitest";
import { computeTimeToGreen } from "./timeToGreen";
import { mphToMps } from "@/lib/geo/units";
import type { SignalIntelligenceResult } from "./SignalIntelligenceEngine";
import type { SignalTimingEstimate } from "@/lib/types";

function makeResult(overrides: Partial<SignalTimingEstimate>, tier: "HIGH" | "ESTIMATED" | "UNAVAILABLE" = "HIGH"): SignalIntelligenceResult {
  const estimate: SignalTimingEstimate = {
    source: "OFFICIAL_LIVE",
    phase: "RED",
    minEndTime: 17_000,
    likelyEndTime: 17_000,
    maxEndTime: 17_000,
    nextGreenStart: 17_000,
    nextGreenEnd: 40_000,
    confidence: 0.99,
    observedAt: 0,
    freshnessMs: 0,
    ...overrides,
  };
  return { estimate, tier, preciseCountdownAllowed: tier === "HIGH", glosaAllowed: tier !== "UNAVAILABLE" };
}

const STOPPED = 0;
const MOVING = mphToMps(20);

describe("computeTimeToGreen", () => {
  it("shows a precise countdown for a HIGH-confidence red with time remaining", () => {
    const result = makeResult({ likelyEndTime: 17_000 }, "HIGH");
    const state = computeTimeToGreen(result, STOPPED, 0);
    expect(state).toEqual({ status: "COUNTDOWN", secondsToGreen: 17 });
  });

  it("switches to WATCH_SIGNAL at/under the watch threshold instead of counting to zero", () => {
    const result = makeResult({ likelyEndTime: 4000 }, "HIGH"); // 4s away, under default 5s threshold
    expect(computeTimeToGreen(result, STOPPED, 0)).toEqual({ status: "WATCH_SIGNAL" });
  });

  it("never returns a COUNTDOWN of 0 or negative — WATCH_SIGNAL covers the threshold boundary", () => {
    const result = makeResult({ likelyEndTime: 5000 }, "HIGH"); // exactly at the 5s threshold
    const state = computeTimeToGreen(result, STOPPED, 0);
    expect(state.status).not.toBe("COUNTDOWN");
  });

  it("shows an estimated range, not a fake-precise number, at ESTIMATED tier", () => {
    const result = makeResult({ minEndTime: 15_000, likelyEndTime: 17_000, maxEndTime: 20_000 }, "ESTIMATED");
    const state = computeTimeToGreen(result, STOPPED, 0);
    expect(state).toEqual({ status: "ESTIMATED_RANGE", minSec: 15, maxSec: 20 });
  });

  it("is UNAVAILABLE while the vehicle is moving — Time-to-Green is a stopped-only behavior", () => {
    const result = makeResult({ likelyEndTime: 17_000 }, "HIGH");
    expect(computeTimeToGreen(result, MOVING, 0)).toEqual({ status: "UNAVAILABLE" });
  });

  it("is UNAVAILABLE when confidence tier is UNAVAILABLE, regardless of stopped state", () => {
    const result: SignalIntelligenceResult = { estimate: null, tier: "UNAVAILABLE", preciseCountdownAllowed: false, glosaAllowed: false };
    expect(computeTimeToGreen(result, STOPPED, 0)).toEqual({ status: "UNAVAILABLE" });
  });

  it("does not activate when the signal is already green (not a 'time to green' situation)", () => {
    const result = makeResult({ phase: "GREEN" }, "HIGH");
    expect(computeTimeToGreen(result, STOPPED, 0)).toEqual({ status: "UNAVAILABLE" });
  });

  it("does not assert a stale (past) prediction", () => {
    const result = makeResult({ likelyEndTime: -5000 }, "HIGH"); // "green" was supposedly 5s ago
    expect(computeTimeToGreen(result, STOPPED, 0)).toEqual({ status: "UNAVAILABLE" });
  });

  it("respects a custom watch threshold", () => {
    const result = makeResult({ likelyEndTime: 9000 }, "HIGH");
    expect(computeTimeToGreen(result, STOPPED, 0, 10).status).toBe("WATCH_SIGNAL");
    expect(computeTimeToGreen(result, STOPPED, 0, 3).status).toBe("COUNTDOWN");
  });
});
