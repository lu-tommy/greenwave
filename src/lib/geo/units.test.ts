import { describe, expect, it } from "vitest";
import { formatDistance, formatDuration, metersToFeet, metersToMiles, mphToMps, mpsToMph, roundMph } from "./units";

describe("unit conversions", () => {
  it("round-trips mph <-> mps", () => {
    const mph = 25;
    expect(mpsToMph(mphToMps(mph))).toBeCloseTo(mph, 6);
  });

  it("converts a known speed: 60 mph ~= 26.82 m/s", () => {
    expect(mphToMps(60)).toBeCloseTo(26.8224, 3);
  });

  it("converts meters to feet and miles", () => {
    expect(metersToFeet(1)).toBeCloseTo(3.28084, 4);
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 6);
  });

  it("rounds mph for display", () => {
    expect(roundMph(mphToMps(21.4))).toBe(21);
    expect(roundMph(mphToMps(21.6))).toBe(22);
  });
});

describe("formatDistance", () => {
  it("shows feet under 1000ft", () => {
    expect(formatDistance(100)).toMatch(/ft$/);
  });

  it("shows miles at or above 1000ft", () => {
    const oneMileM = 1609.344;
    expect(formatDistance(oneMileM)).toMatch(/mi$/);
  });

  it("clamps negative distances to 0 ft", () => {
    expect(formatDistance(-50)).toBe("0 ft");
  });
});

describe("formatDuration", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatDuration(42)).toBe("42s");
  });

  it("formats minute-scale durations as M:SS", () => {
    expect(formatDuration(292)).toBe("4:52");
  });

  it("clamps negative durations to 0s", () => {
    expect(formatDuration(-5)).toBe("0s");
  });
});
