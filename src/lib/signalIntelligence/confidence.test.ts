import { describe, expect, it } from "vitest";
import { CONFIDENCE_THRESHOLDS, confidenceTier, effectiveConfidence, isEvidenceFresh } from "./confidence";

describe("confidenceTier", () => {
  it("classifies >= 0.95 as HIGH", () => {
    expect(confidenceTier(0.95)).toBe("HIGH");
    expect(confidenceTier(0.99)).toBe("HIGH");
  });

  it("classifies [0.80, 0.95) as ESTIMATED", () => {
    expect(confidenceTier(0.8)).toBe("ESTIMATED");
    expect(confidenceTier(0.94)).toBe("ESTIMATED");
  });

  it("classifies < 0.80 as UNAVAILABLE", () => {
    expect(confidenceTier(0.79)).toBe("UNAVAILABLE");
    expect(confidenceTier(0)).toBe("UNAVAILABLE");
  });

  it("exposes centralized thresholds rather than hardcoding them elsewhere", () => {
    expect(CONFIDENCE_THRESHOLDS.HIGH).toBe(0.95);
    expect(CONFIDENCE_THRESHOLDS.ESTIMATED).toBe(0.8);
  });
});

describe("freshness: OFFICIAL_LIVE (fast decay, hard expiry)", () => {
  it("is excellent (full confidence) 500ms after observation", () => {
    const evidence = { source: "OFFICIAL_LIVE" as const, observedAt: 0, confidence: 0.99 };
    expect(effectiveConfidence(evidence, 500)).toBe(0.99);
    expect(isEvidenceFresh(evidence, 500)).toBe(true);
  });

  it("is unusable (confidence 0, not fresh) 20 seconds after observation", () => {
    const evidence = { source: "OFFICIAL_LIVE" as const, observedAt: 0, confidence: 0.99 };
    expect(effectiveConfidence(evidence, 20_000)).toBe(0);
    expect(isEvidenceFresh(evidence, 20_000)).toBe(false);
  });

  it("decays smoothly between decayStart and hardExpiry rather than jumping straight to 0", () => {
    const evidence = { source: "OFFICIAL_LIVE" as const, observedAt: 0, confidence: 1 };
    const mid = effectiveConfidence(evidence, 5_500); // halfway between 3s decay start and 8s hard expiry
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("never reports negative or over-100% confidence at any age", () => {
    const evidence = { source: "OFFICIAL_LIVE" as const, observedAt: 0, confidence: 0.9 };
    for (const ageMs of [0, 1000, 3000, 5000, 8000, 50_000]) {
      const c = effectiveConfidence(evidence, ageMs);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0.9);
    }
  });
});

describe("freshness: LEARNED (slow, soft decay)", () => {
  it("a fixed-cycle learned model from yesterday remains useful", () => {
    const evidence = { source: "LEARNED" as const, observedAt: 0, confidence: 0.7 };
    const oneDayMs = 24 * 60 * 60 * 1000;
    expect(effectiveConfidence(evidence, oneDayMs)).toBe(0.7); // within the 30-day decay-start window
    expect(isEvidenceFresh(evidence, oneDayMs)).toBe(true);
  });

  it("decays toward 0 well before official-live evidence would even be considered, but far slower", () => {
    const evidence = { source: "LEARNED" as const, observedAt: 0, confidence: 0.7 };
    const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
    const decayed = effectiveConfidence(evidence, sixtyDaysMs);
    expect(decayed).toBeLessThan(0.7);
    expect(decayed).toBeGreaterThan(0);
  });
});

describe("freshness: MANUAL and OFFICIAL_STATIC barely decay from age alone", () => {
  it("a manual calibration from a month ago is still treated as full confidence", () => {
    const evidence = { source: "MANUAL" as const, observedAt: 0, confidence: 0.9 };
    const oneMonthMs = 30 * 24 * 60 * 60 * 1000;
    expect(effectiveConfidence(evidence, oneMonthMs)).toBe(0.9);
  });
});

describe("effectiveConfidence never exceeds the raw confidence", () => {
  it("at age 0, effective confidence equals the source confidence exactly", () => {
    for (const source of ["OFFICIAL_LIVE", "EXTERNAL_LIVE", "LEARNED", "MANUAL", "OFFICIAL_STATIC", "HISTORICAL"] as const) {
      const evidence = { source, observedAt: 1000, confidence: 0.6 };
      expect(effectiveConfidence(evidence, 1000)).toBe(0.6);
    }
  });
});
