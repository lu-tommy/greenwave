import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllSignalKnowledge,
  deleteSignalKnowledge,
  ensureSignalKnowledge,
  getAllSignalKnowledge,
  getSignalKnowledge,
  putSignalKnowledge,
} from "./signalKnowledgeStore";
import { addObservation, clearAllObservations, getObservationsForSession, getObservationsForSignal } from "./driveObservationStore";
import { clearAllDriveSessions, getAllDriveSessions, getDriveSession, putDriveSession } from "./driveSessionStore";
import type { DriveObservation, DriveSession, SignalKnowledgeRecord } from "@/lib/types";

beforeEach(async () => {
  await clearAllSignalKnowledge();
  await clearAllObservations();
  await clearAllDriveSessions();
});

describe("signalKnowledgeStore", () => {
  it("persists and retrieves a record", async () => {
    const record: SignalKnowledgeRecord = {
      signalId: "osm:node:1",
      lat: 1,
      lng: 2,
      direction: 90,
      timingModel: null,
      observationCount: 0,
      firstObservedAt: 100,
      lastObservedAt: 100,
    };
    await putSignalKnowledge(record);
    const fetched = await getSignalKnowledge("osm:node:1");
    expect(fetched).toEqual(record);
  });

  it("ensureSignalKnowledge creates a blank record only if none exists", async () => {
    const first = await ensureSignalKnowledge("osm:node:2", { lat: 5, lng: 6 }, null);
    expect(first.timingModel).toBeNull();
    expect(first.observationCount).toBe(0);

    await putSignalKnowledge({ ...first, observationCount: 3 });
    const second = await ensureSignalKnowledge("osm:node:2", { lat: 5, lng: 6 }, null);
    expect(second.observationCount).toBe(3); // did not reset the existing record
  });

  it("deletes a record", async () => {
    await putSignalKnowledge({
      signalId: "osm:node:3",
      lat: 0,
      lng: 0,
      direction: null,
      timingModel: null,
      observationCount: 1,
      firstObservedAt: 0,
      lastObservedAt: 0,
    });
    await deleteSignalKnowledge("osm:node:3");
    expect(await getSignalKnowledge("osm:node:3")).toBeUndefined();
  });

  it("getAllSignalKnowledge returns every stored record", async () => {
    await putSignalKnowledge({
      signalId: "a",
      lat: 0,
      lng: 0,
      direction: null,
      timingModel: null,
      observationCount: 0,
      firstObservedAt: 0,
      lastObservedAt: 0,
    });
    await putSignalKnowledge({
      signalId: "b",
      lat: 0,
      lng: 0,
      direction: null,
      timingModel: null,
      observationCount: 0,
      firstObservedAt: 0,
      lastObservedAt: 0,
    });
    const all = await getAllSignalKnowledge();
    expect(all.map((r) => r.signalId).sort()).toEqual(["a", "b"]);
  });
});

describe("driveObservationStore", () => {
  function makeObs(overrides: Partial<DriveObservation>): DriveObservation {
    return {
      id: crypto.randomUUID(),
      signalId: "osm:node:1",
      driveSessionId: "session-1",
      type: "DEPART_SIGNAL",
      timestamp: Date.now(),
      lat: 0,
      lng: 0,
      speedMps: 5,
      distanceToSignalM: 10,
      routeHeadingDeg: 90,
      confidence: 0.4,
      ...overrides,
    };
  }

  it("stores and retrieves observations by signal, ordered by time", async () => {
    await addObservation(makeObs({ id: "o2", timestamp: 200 }));
    await addObservation(makeObs({ id: "o1", timestamp: 100 }));
    const obs = await getObservationsForSignal("osm:node:1");
    expect(obs.map((o) => o.id)).toEqual(["o1", "o2"]);
  });

  it("retrieves observations by drive session", async () => {
    await addObservation(makeObs({ id: "o1", driveSessionId: "s1" }));
    await addObservation(makeObs({ id: "o2", driveSessionId: "s2" }));
    const obs = await getObservationsForSession("s1");
    expect(obs.map((o) => o.id)).toEqual(["o1"]);
  });
});

describe("driveSessionStore", () => {
  function makeSession(overrides: Partial<DriveSession>): DriveSession {
    return {
      id: crypto.randomUUID(),
      origin: { lat: 0, lng: 0 },
      destination: { lat: 1, lng: 1 },
      destinationLabel: "Somewhere",
      routeId: "r1",
      routeHash: "hash1",
      startedAt: Date.now(),
      endedAt: null,
      distanceM: 0,
      durationSec: 0,
      signalsEncountered: 0,
      knownSignalsEncountered: 0,
      stops: 0,
      observationIds: [],
      ...overrides,
    };
  }

  it("persists and lists sessions, newest first", async () => {
    await putDriveSession(makeSession({ id: "s1", startedAt: 100 }));
    await putDriveSession(makeSession({ id: "s2", startedAt: 200 }));
    const all = await getAllDriveSessions();
    expect(all.map((s) => s.id)).toEqual(["s2", "s1"]);
  });

  it("retrieves a single session by id", async () => {
    await putDriveSession(makeSession({ id: "s3" }));
    const session = await getDriveSession("s3");
    expect(session?.id).toBe("s3");
  });
});
