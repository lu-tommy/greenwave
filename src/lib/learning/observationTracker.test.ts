import { describe, expect, it } from "vitest";
import { ObservationTracker } from "./observationTracker";
import type { TrackerSample } from "./observationTracker";
import { mphToMps } from "@/lib/geo/units";

const SIGNAL = { id: "osm:node:1", distanceAlongCorridorM: 100 };

function sample(overrides: Partial<TrackerSample>): TrackerSample {
  return {
    timestamp: 0,
    positionM: 0,
    speedMps: mphToMps(20),
    position: { lat: 0, lng: 0 },
    routeHeadingDeg: 90,
    ...overrides,
  };
}

describe("ObservationTracker", () => {
  it("emits STOP_AT_SIGNAL then DEPART_SIGNAL for a genuine stop-and-go approach", () => {
    const tracker = new ObservationTracker();
    // Approaching, still moving.
    tracker.processTick(sample({ timestamp: 0, positionM: 85, speedMps: mphToMps(10) }), [SIGNAL]);
    // Comes to a stop near the signal.
    tracker.processTick(sample({ timestamp: 1000, positionM: 98, speedMps: 0 }), [SIGNAL]);
    tracker.processTick(sample({ timestamp: 2000, positionM: 98, speedMps: 0 }), [SIGNAL]);
    tracker.processTick(sample({ timestamp: 3500, positionM: 98, speedMps: 0 }), [SIGNAL]);
    // Departs.
    const events = tracker.processTick(sample({ timestamp: 4500, positionM: 102, speedMps: mphToMps(8) }), [SIGNAL]);

    expect(events.map((e) => e.type)).toEqual(["STOP_AT_SIGNAL", "DEPART_SIGNAL"]);
    expect(events[0].timestamp).toBe(1000);
    expect(events[1].timestamp).toBe(4500);
  });

  it("does not emit a stop/depart pair for a very brief slowdown (not a real stop)", () => {
    const tracker = new ObservationTracker();
    tracker.processTick(sample({ timestamp: 0, positionM: 90, speedMps: mphToMps(10) }), [SIGNAL]);
    tracker.processTick(sample({ timestamp: 200, positionM: 98, speedMps: 0 }), [SIGNAL]);
    const events = tracker.processTick(sample({ timestamp: 400, positionM: 99, speedMps: mphToMps(8) }), [SIGNAL]);
    expect(events).toEqual([]);
  });

  it("emits PASS_SIGNAL_WITHOUT_STOP when the vehicle never slows down through the signal", () => {
    const tracker = new ObservationTracker();
    tracker.processTick(sample({ timestamp: 0, positionM: 80, speedMps: mphToMps(20) }), [SIGNAL]);
    tracker.processTick(sample({ timestamp: 1000, positionM: 98, speedMps: mphToMps(20) }), [SIGNAL]);
    const events = tracker.processTick(sample({ timestamp: 2000, positionM: 108, speedMps: mphToMps(20) }), [SIGNAL]);
    expect(events.map((e) => e.type)).toEqual(["PASS_SIGNAL_WITHOUT_STOP"]);
  });

  it("only emits one terminal event per signal approach (no duplicates on later ticks)", () => {
    const tracker = new ObservationTracker();
    tracker.processTick(sample({ timestamp: 0, positionM: 80, speedMps: mphToMps(20) }), [SIGNAL]);
    tracker.processTick(sample({ timestamp: 1000, positionM: 108, speedMps: mphToMps(20) }), [SIGNAL]);
    const later = tracker.processTick(sample({ timestamp: 2000, positionM: 115, speedMps: mphToMps(20) }), [SIGNAL]);
    expect(later).toEqual([]);
  });

  it("ignores signals outside the approach window", () => {
    const tracker = new ObservationTracker();
    const farSignal = { id: "osm:node:2", distanceAlongCorridorM: 5000 };
    const events = tracker.processTick(sample({ timestamp: 0, positionM: 0, speedMps: 0 }), [farSignal]);
    expect(events).toEqual([]);
  });

  it("reset() clears per-signal state so a new approach can be tracked again", () => {
    const tracker = new ObservationTracker();
    tracker.processTick(sample({ timestamp: 0, positionM: 80, speedMps: mphToMps(20) }), [SIGNAL]);
    tracker.processTick(sample({ timestamp: 1000, positionM: 108, speedMps: mphToMps(20) }), [SIGNAL]);
    tracker.reset();
    const events = tracker.processTick(sample({ timestamp: 2000, positionM: 80, speedMps: mphToMps(20) }), [SIGNAL]);
    // After reset, approaching again should be trackable from scratch (no immediate emission yet).
    expect(events).toEqual([]);
  });
});
