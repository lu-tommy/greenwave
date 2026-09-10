import { describe, expect, it } from "vitest";
import { initialSpeedFilterState, updateSpeedFilter } from "./speedFilter";

describe("updateSpeedFilter", () => {
  it("uses the reported speed when available", () => {
    const { speedMps } = updateSpeedFilter(initialSpeedFilterState, {
      timestamp: 0,
      position: { lat: 0, lng: 0 },
      reportedSpeedMps: 10,
    });
    expect(speedMps).toBeCloseTo(10, 1);
  });

  it("derives speed from consecutive position fixes when speed is unavailable", () => {
    let state = initialSpeedFilterState;
    let result = updateSpeedFilter(state, { timestamp: 0, position: { lat: 0, lng: 0 } });
    state = result.state;
    // ~111.32 m east-west shift per 0.001 deg lng at equator, over 10s => ~11 m/s
    result = updateSpeedFilter(state, { timestamp: 10_000, position: { lat: 0, lng: 0.001 } });
    expect(result.speedMps).toBeGreaterThan(5);
    expect(result.speedMps).toBeLessThan(20);
  });

  it("rejects a single implausible jump rather than snapping the estimate to it", () => {
    let state = initialSpeedFilterState;
    for (let i = 0; i < 5; i++) {
      const r = updateSpeedFilter(state, { timestamp: i * 1000, position: { lat: 0, lng: 0 }, reportedSpeedMps: 10 });
      state = r.state;
    }
    const before = state.emaSpeedMps!;
    const jump = updateSpeedFilter(state, {
      timestamp: 5000 + 200,
      position: { lat: 0, lng: 0 },
      reportedSpeedMps: 80, // implausible: +70 m/s in 0.2s
    });
    expect(jump.speedMps).toBeCloseTo(before, 1);
  });

  it("smooths a gradual, plausible speed change rather than snapping instantly", () => {
    let state = initialSpeedFilterState;
    for (let i = 0; i < 5; i++) {
      const r = updateSpeedFilter(state, { timestamp: i * 1000, position: { lat: 0, lng: 0 }, reportedSpeedMps: 10 });
      state = r.state;
    }
    // Feed several consecutive 15 m/s samples: the estimate should ease
    // toward 15 over multiple updates rather than jumping there in one.
    let last = 10;
    for (let i = 0; i < 4; i++) {
      const r = updateSpeedFilter(state, { timestamp: 6000 + i * 1000, position: { lat: 0, lng: 0 }, reportedSpeedMps: 15 });
      state = r.state;
      expect(r.speedMps).toBeGreaterThanOrEqual(last - 1e-6);
      last = r.speedMps!;
    }
    expect(last).toBeGreaterThan(10);
    expect(last).toBeLessThan(15);
  });
});
