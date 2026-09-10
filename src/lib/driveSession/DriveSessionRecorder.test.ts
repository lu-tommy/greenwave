import { beforeEach, describe, expect, it } from "vitest";
import { DriveSessionRecorder } from "./DriveSessionRecorder";
import { clearAllSignalKnowledge, getSignalKnowledge } from "@/lib/storage/signalKnowledgeStore";
import { clearAllObservations } from "@/lib/storage/driveObservationStore";
import { clearAllDriveSessions } from "@/lib/storage/driveSessionStore";
import { makeManualObservation } from "@/lib/learning/observationTracker";
import type { Corridor } from "@/lib/types";

beforeEach(async () => {
  await clearAllSignalKnowledge();
  await clearAllObservations();
  await clearAllDriveSessions();
});

const ORIGIN = { lat: 0, lng: 0 };
const DEST = { lat: 1, lng: 1 };

function makeCorridor(signalPlanForA: Corridor["intersections"][number]["signalPlan"]): Corridor {
  return {
    id: "route:test",
    name: "Test Route",
    direction: "Route",
    speedLimitMps: 11.2,
    polyline: [ORIGIN, DEST],
    intersections: [
      {
        id: "osm:node:a",
        name: "A",
        lat: 0,
        lng: 0,
        distanceAlongCorridorM: 100,
        signalPlan: signalPlanForA,
        confidence: signalPlanForA ? 0.5 : 0,
      },
    ],
    dataSourceLabel: "OSM SIGNAL LOCATIONS · TIMING VARIES",
  };
}

describe("DriveSessionRecorder", () => {
  it("tracks encountered vs known-encountered signals as the vehicle passes them", () => {
    const recorder = new DriveSessionRecorder(ORIGIN, DEST, "Dest", "route-1", "hash-1");
    const corridor = makeCorridor(null);
    const rec = {
      timestamp: 0,
      instruction: "HOLD" as const,
      targetSpeedMps: 5,
      speedLimitMps: 11.2,
      greenWaveCount: 0,
      greenWaveDistanceM: 0,
      isGreenWave: false,
      upcoming: [],
      confidence: 0,
      reason: "LEARNING ROUTE",
    };
    recorder.recordTick({ timestamp: 0, positionM: 50, speedMps: 5 }, rec, corridor);
    recorder.recordTick({ timestamp: 2000, positionM: 150, speedMps: 5 }, rec, corridor); // passes the signal at 100m
    // no direct getter, so verify via finish()
    return recorder.finish({ distanceM: 150, durationSec: 2 }).then((summary) => {
      expect(summary.session.signalsEncountered).toBe(1);
      expect(summary.session.knownSignalsEncountered).toBe(0);
    });
  });

  it("persists observations and updates signal knowledge, reporting improved models", async () => {
    const recorder = new DriveSessionRecorder(ORIGIN, DEST, "Dest", "route-1", "hash-1");
    const corridor = makeCorridor(null);

    const T0 = Date.UTC(2026, 5, 1, 8, 0, 0);
    const CYCLE = 60_000;
    const WAIT = 20_000;
    for (let k = 0; k < 4; k++) {
      const greenAt = T0 + k * CYCLE;
      await recorder.recordManualObservation({
        signalId: "osm:node:a",
        type: "GREEN_START_MANUAL",
        timestamp: greenAt,
        lat: 0,
        lng: 0,
        speedMps: 0,
        distanceToSignalM: 0,
        routeHeadingDeg: 90,
        confidence: 0.95,
      });
      // Manual green-only anchors won't produce a full plan (no red evidence) —
      // add matching stop observations too so this test can assert a model appears.
      recorder.recordObservations([
        {
          signalId: "osm:node:a",
          type: "STOP_AT_SIGNAL",
          timestamp: greenAt - WAIT,
          lat: 0,
          lng: 0,
          speedMps: 0,
          distanceToSignalM: 5,
          routeHeadingDeg: 90,
          confidence: 0.3,
        },
      ]);
    }

    recorder.recordTick({ timestamp: T0, positionM: 0, speedMps: 5 }, {
      timestamp: T0,
      instruction: "HOLD",
      targetSpeedMps: 5,
      speedLimitMps: 11.2,
      greenWaveCount: 0,
      greenWaveDistanceM: 0,
      isGreenWave: false,
      upcoming: [],
      confidence: 0,
      reason: "LEARNING ROUTE",
    }, corridor);

    const summary = await recorder.finish({ distanceM: 500, durationSec: 300 });
    expect(summary.newObservations).toBe(8); // 4 manual + 4 stop
    expect(summary.timingModelsImproved).toBe(1);

    const knowledge = await getSignalKnowledge("osm:node:a");
    expect(knowledge?.timingModel).not.toBeNull();
    expect(knowledge?.timingModel?.cycleSec).toBe(60);
    expect(knowledge?.observationCount).toBe(8);
  });

  it("exports a structured debug JSON with history, observations, and signal state", async () => {
    const recorder = new DriveSessionRecorder(ORIGIN, DEST, "Dest", "route-1", "hash-1");
    const corridor = makeCorridor(null);
    const rec = {
      timestamp: 1000,
      instruction: "HOLD" as const,
      targetSpeedMps: 5,
      speedLimitMps: 11.2,
      greenWaveCount: 0,
      greenWaveDistanceM: 0,
      isGreenWave: false,
      upcoming: [],
      confidence: 0,
      reason: "LEARNING ROUTE",
    };
    recorder.recordTick({ timestamp: 1000, positionM: 10, speedMps: 5 }, rec, corridor);
    recorder.recordObservations([makeManualObservation("osm:node:a", "GREEN_START_MANUAL", {
      timestamp: 1000, positionM: 10, speedMps: 5, position: { lat: 0, lng: 0 }, routeHeadingDeg: 90,
    }, 90)]);

    await recorder.finish({ distanceM: 10, durationSec: 1 });
    const debugJson = await recorder.exportDebugJson();

    expect(debugJson.formatVersion).toBe(1);
    expect(debugJson.history.length).toBeGreaterThan(0);
    expect(debugJson.observations.length).toBe(1);
    expect(debugJson.signalsAtDriveEnd).toHaveLength(1);
    expect(debugJson.signalsAtDriveEnd[0].hadTimingModel).toBe(false);
  });
});
