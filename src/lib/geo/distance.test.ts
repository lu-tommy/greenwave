import { describe, expect, it } from "vitest";
import { haversineDistance, pointAtDistance, projectOntoPolyline, totalPolylineLength } from "./distance";

describe("haversineDistance", () => {
  it("is zero for identical points", () => {
    expect(haversineDistance({ lat: 40, lng: -105 }, { lat: 40, lng: -105 })).toBeCloseTo(0, 6);
  });

  it("approximates a known distance (~1 deg latitude ~= 111.2 km)", () => {
    const d = haversineDistance({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

const straightLine = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 0.01 },
  { lat: 0, lng: 0.02 },
];

describe("pointAtDistance / totalPolylineLength", () => {
  it("returns the start point at distance 0", () => {
    const p = pointAtDistance(straightLine, 0);
    expect(p.lat).toBeCloseTo(0, 6);
    expect(p.lng).toBeCloseTo(0, 6);
  });

  it("returns the end point when distance exceeds total length", () => {
    const total = totalPolylineLength(straightLine);
    const p = pointAtDistance(straightLine, total + 10_000);
    expect(p.lng).toBeCloseTo(0.02, 6);
  });

  it("interpolates a midpoint", () => {
    const total = totalPolylineLength(straightLine);
    const p = pointAtDistance(straightLine, total / 2);
    expect(p.lng).toBeCloseTo(0.01, 4);
  });
});

describe("projectOntoPolyline", () => {
  it("projects a point exactly on the line with ~zero offset", () => {
    const result = projectOntoPolyline({ lat: 0, lng: 0.01 }, straightLine);
    expect(result.offsetM).toBeLessThan(1);
  });

  it("reports increasing distanceAlongM as the query point moves along the line", () => {
    const near = projectOntoPolyline({ lat: 0, lng: 0.001 }, straightLine);
    const far = projectOntoPolyline({ lat: 0, lng: 0.015 }, straightLine);
    expect(far.distanceAlongM).toBeGreaterThan(near.distanceAlongM);
  });

  it("reports a nonzero offset for a point off the line", () => {
    const result = projectOntoPolyline({ lat: 0.001, lng: 0.01 }, straightLine);
    expect(result.offsetM).toBeGreaterThan(50);
  });

  it("clamps projection to the polyline's endpoints", () => {
    const beforeStart = projectOntoPolyline({ lat: 0, lng: -0.05 }, straightLine);
    expect(beforeStart.distanceAlongM).toBe(0);
  });
});
