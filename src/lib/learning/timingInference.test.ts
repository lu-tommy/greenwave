import { describe, expect, it } from "vitest";
import { classifyControlType, decayModelConfidence, inferTimingModel, resynchronize } from "./timingInference";
import type { DriveObservation, LearnedTimingModel } from "@/lib/types";

const T0 = Date.UTC(2026, 5, 1, 8, 0, 0);

function obs(overrides: Partial<DriveObservation>): DriveObservation {
  return {
    id: crypto.randomUUID(),
    signalId: "osm:node:1",
    driveSessionId: "s1",
    type: "DEPART_SIGNAL",
    timestamp: T0,
    lat: 0,
    lng: 0,
    speedMps: 5,
    distanceToSignalM: 10,
    routeHeadingDeg: 90,
    confidence: 0.35,
    ...overrides,
  };
}

describe("inferTimingModel", () => {
  it("returns null with fewer than 3 anchor observations", () => {
    const observations = [
      obs({ type: "STOP_AT_SIGNAL", timestamp: T0 }),
      obs({ type: "DEPART_SIGNAL", timestamp: T0 + 20_000 }),
    ];
    expect(inferTimingModel(observations)).toBeNull();
  });

  it("returns null for anchors with no consistent periodicity", () => {
    const observations = [
      obs({ type: "GREEN_START_MANUAL", timestamp: T0, confidence: 0.95 }),
      obs({ type: "GREEN_START_MANUAL", timestamp: T0 + 17_000, confidence: 0.95 }),
      obs({ type: "GREEN_START_MANUAL", timestamp: T0 + 63_000, confidence: 0.95 }),
      obs({ type: "GREEN_START_MANUAL", timestamp: T0 + 121_000, confidence: 0.95 }),
    ];
    expect(inferTimingModel(observations)).toBeNull();
  });

  it("infers a cycle length from clearly periodic green-start anchors plus stop/depart wait pairs", () => {
    const CYCLE = 90_000;
    const WAIT = 20_000;
    const observations: DriveObservation[] = [];
    for (let k = 0; k < 5; k++) {
      const greenAt = T0 + k * CYCLE;
      observations.push(obs({ type: "STOP_AT_SIGNAL", timestamp: greenAt - WAIT, confidence: 0.5 }));
      observations.push(obs({ type: "GREEN_START_MANUAL", timestamp: greenAt, confidence: 0.95 }));
    }

    const model = inferTimingModel(observations);
    expect(model).not.toBeNull();
    expect(model!.cycleSec).toBe(90);
    expect(model!.redSec).toBeCloseTo(20, 0);
    expect(model!.greenSec + model!.yellowSec + model!.redSec).toBe(model!.cycleSec);
    expect(model!.confidence).toBeGreaterThan(0);
    expect(model!.confidence).toBeLessThanOrEqual(0.75);
  });

  it("does not produce a full plan from green-start anchors alone, without any stop/depart wait evidence", () => {
    const CYCLE = 60_000;
    const observations: DriveObservation[] = [];
    for (let k = 0; k < 5; k++) {
      observations.push(obs({ type: "GREEN_START_MANUAL", timestamp: T0 + k * CYCLE, confidence: 0.95 }));
    }
    expect(inferTimingModel(observations)).toBeNull();
  });

  it("never asserts green+yellow+red inconsistent with the inferred cycle", () => {
    const CYCLE = 60_000;
    const WAIT = 20_000;
    const observations: DriveObservation[] = [];
    for (let k = 0; k < 4; k++) {
      const greenAt = T0 + k * CYCLE;
      observations.push(obs({ type: "STOP_AT_SIGNAL", timestamp: greenAt - WAIT, confidence: 0.5 }));
      observations.push(obs({ type: "GREEN_START_MANUAL", timestamp: greenAt, confidence: 0.95 }));
    }
    const model = inferTimingModel(observations);
    expect(model).not.toBeNull();
    expect(model!.greenSec + model!.yellowSec + model!.redSec).toBe(model!.cycleSec);
  });
});

describe("decayModelConfidence", () => {
  it("does not reduce confidence for a just-updated model", () => {
    const model = {
      cycleSec: 60,
      greenSec: 28,
      yellowSec: 3,
      redSec: 29,
      offsetSec: 0,
      confidence: 0.6,
      sampleCount: 5,
      updatedAt: T0,
    };
    const decayed = decayModelConfidence(model, T0);
    expect(decayed.confidence).toBeCloseTo(0.6, 5);
  });

  it("reduces confidence for a stale model", () => {
    const model = {
      cycleSec: 60,
      greenSec: 28,
      yellowSec: 3,
      redSec: 29,
      offsetSec: 0,
      confidence: 0.6,
      sampleCount: 5,
      updatedAt: T0,
    };
    const sixtyDaysLater = T0 + 1000 * 60 * 60 * 24 * 60;
    const decayed = decayModelConfidence(model, sixtyDaysLater);
    expect(decayed.confidence).toBeLessThan(model.confidence);
  });
});

describe("classifyControlType", () => {
  it("classifies a signal whose green-start anchors line up tightly as FIXED_OR_COORDINATED", () => {
    const CYCLE = 60_000;
    const observations: DriveObservation[] = [];
    for (let k = 0; k < 5; k++) {
      observations.push(obs({ type: "GREEN_START_MANUAL", timestamp: T0 + k * CYCLE, confidence: 0.95 }));
    }
    expect(classifyControlType(observations)).toBe("FIXED_OR_COORDINATED");
  });

  it("classifies a signal with wildly inconsistent green-start timing as LIKELY_ACTUATED", () => {
    // No consistent cycle: gaps of 17s, 63s, 121s, 8s between arbitrary anchors.
    const timestamps = [T0, T0 + 17_000, T0 + 80_000, T0 + 201_000, T0 + 209_000];
    const observations = timestamps.map((t) => obs({ type: "GREEN_START_MANUAL", timestamp: t, confidence: 0.9 }));
    expect(classifyControlType(observations)).toBe("LIKELY_ACTUATED");
  });

  it("returns UNKNOWN_CONTROL_TYPE with too few anchor observations", () => {
    const observations = [obs({ type: "GREEN_START_MANUAL", timestamp: T0 })];
    expect(classifyControlType(observations)).toBe("UNKNOWN_CONTROL_TYPE");
  });
});

describe("resynchronize", () => {
  const baseModel: LearnedTimingModel = {
    cycleSec: 60,
    greenSec: 28,
    yellowSec: 3,
    redSec: 29,
    offsetSec: 10,
    confidence: 0.7,
    sampleCount: 5,
    updatedAt: T0,
  };

  it("re-anchors offsetSec from a manual green-start anchor without changing cycleSec", () => {
    const anchor = obs({ type: "GREEN_START_MANUAL", timestamp: T0 + 125_000, confidence: 0.95 }); // 125s -> pos 5s within a 60s cycle
    const resynced = resynchronize(baseModel, anchor, T0 + 200_000);
    expect(resynced.cycleSec).toBe(60); // unchanged — resync never relearns the cycle
    expect(resynced.offsetSec).toBeCloseTo(5, 5);
    expect(resynced.lastSynchronizedAt).toBe(T0 + 200_000);
    expect(resynced.synchronizationConfidence).toBe(0.95);
  });

  it("does not resynchronize from a weaker, passive DEPART_SIGNAL observation", () => {
    const anchor = obs({ type: "DEPART_SIGNAL", timestamp: T0 + 125_000, confidence: 0.35 });
    const result = resynchronize(baseModel, anchor);
    expect(result).toBe(baseModel); // untouched
  });
});
