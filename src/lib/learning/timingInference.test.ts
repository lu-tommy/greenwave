import { describe, expect, it } from "vitest";
import { decayModelConfidence, inferTimingModel } from "./timingInference";
import type { DriveObservation } from "@/lib/types";

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
