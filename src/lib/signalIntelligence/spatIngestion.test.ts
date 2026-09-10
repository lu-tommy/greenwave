import { describe, expect, it } from "vitest";
import { parseSpatMessage, SpatMessageStore, SpatSignalTimingProvider } from "./spatIngestion";
import type { SignalApproach } from "@/lib/types";

describe("parseSpatMessage", () => {
  it("parses a valid message", () => {
    const raw = {
      intersectionId: "osm:node:1",
      timestamp: 1000,
      signalGroups: [
        { signalGroupId: "g1", movement: "THROUGH", events: [{ state: "RED", minEndTime: 5000 }] },
      ],
    };
    const parsed = parseSpatMessage(raw);
    expect(parsed.intersectionId).toBe("osm:node:1");
    expect(parsed.signalGroups[0].events[0].state).toBe("RED");
  });

  it("rejects a message missing intersectionId", () => {
    expect(() => parseSpatMessage({ timestamp: 1000, signalGroups: [] })).toThrow(/intersectionId/);
  });

  it("rejects a message with a non-numeric timestamp", () => {
    expect(() => parseSpatMessage({ intersectionId: "a", timestamp: "now", signalGroups: [] })).toThrow(/timestamp/);
  });

  it("rejects a signal group with an invalid event state", () => {
    const raw = {
      intersectionId: "a",
      timestamp: 1000,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "PURPLE", minEndTime: 5000 }] }],
    };
    expect(() => parseSpatMessage(raw)).toThrow(/events/);
  });

  it("rejects an event missing minEndTime", () => {
    const raw = {
      intersectionId: "a",
      timestamp: 1000,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "RED" }] }],
    };
    expect(() => parseSpatMessage(raw)).toThrow();
  });

  it("rejects a non-object payload", () => {
    expect(() => parseSpatMessage("not an object")).toThrow();
    expect(() => parseSpatMessage(null)).toThrow();
  });
});

describe("SpatMessageStore", () => {
  it("stores and retrieves the latest message per intersection", () => {
    const store = new SpatMessageStore();
    store.ingest({ intersectionId: "a", timestamp: 1000, signalGroups: [] });
    store.ingest({ intersectionId: "a", timestamp: 2000, signalGroups: [] });
    expect(store.getLatest("a")?.timestamp).toBe(2000);
  });

  it("returns null for an intersection with no ingested message", () => {
    const store = new SpatMessageStore();
    expect(store.getLatest("never-seen")).toBeNull();
  });
});

const APPROACH: SignalApproach = { signalId: "osm:node:1", approachId: "osm:node:1:THROUGH", direction: 90, maneuver: "THROUGH" };

describe("SpatSignalTimingProvider", () => {
  it("returns null when nothing has been ingested for this signal", async () => {
    const provider = new SpatSignalTimingProvider(new SpatMessageStore());
    expect(await provider.getTiming(APPROACH, 0)).toBeNull();
  });

  it("reports the current phase and window from the latest ingested message", async () => {
    const store = new SpatMessageStore();
    store.ingest({
      intersectionId: "osm:node:1",
      timestamp: 1000,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "RED", minEndTime: 6000, likelyEndTime: 5500, maxEndTime: 6500 }] }],
    });
    const provider = new SpatSignalTimingProvider(store);
    const evidence = await provider.getTiming(APPROACH, 1000);
    expect(evidence?.source).toBe("OFFICIAL_LIVE");
    expect(evidence?.phase).toBe("RED");
    expect(evidence?.likelyEndTime).toBe(5500);
  });

  it("derives the next-green window from a red-then-green event sequence", async () => {
    const store = new SpatMessageStore();
    store.ingest({
      intersectionId: "osm:node:1",
      timestamp: 1000,
      signalGroups: [
        {
          signalGroupId: "g1",
          movement: "THROUGH",
          events: [
            { state: "RED", minEndTime: 6000, likelyEndTime: 5500 },
            { state: "GREEN", minEndTime: 30_000, likelyEndTime: 29_500 },
          ],
        },
      ],
    });
    const provider = new SpatSignalTimingProvider(store);
    const evidence = await provider.getTiming(APPROACH, 1000);
    expect(evidence?.nextGreenStart).toBe(5500);
    expect(evidence?.nextGreenEnd).toBe(29_500);
  });

  it("reports nextGreenStart as now when the signal is already green", async () => {
    const store = new SpatMessageStore();
    store.ingest({
      intersectionId: "osm:node:1",
      timestamp: 1000,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "GREEN", minEndTime: 10_000, likelyEndTime: 9500 }] }],
    });
    const provider = new SpatSignalTimingProvider(store);
    const evidence = await provider.getTiming(APPROACH, 1000);
    expect(evidence?.nextGreenStart).toBe(1000);
    expect(evidence?.nextGreenEnd).toBe(9500);
  });

  it("falls back to the THROUGH group for an UNKNOWN-movement approach", async () => {
    const store = new SpatMessageStore();
    store.ingest({
      intersectionId: "osm:node:1",
      timestamp: 1000,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "GREEN", minEndTime: 5000 }] }],
    });
    const provider = new SpatSignalTimingProvider(store);
    const unknownApproach: SignalApproach = { signalId: "osm:node:1", approachId: "osm:node:1:UNKNOWN", direction: 90, maneuver: "UNKNOWN" };
    const evidence = await provider.getTiming(unknownApproach, 1000);
    expect(evidence?.phase).toBe("GREEN");
  });

  it("safety: never substitutes THROUGH timing for a LEFT-turn movement it has no group for", async () => {
    const store = new SpatMessageStore();
    store.ingest({
      intersectionId: "osm:node:1",
      timestamp: 1000,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "GREEN", minEndTime: 5000 }] }],
    });
    const provider = new SpatSignalTimingProvider(store);
    const leftApproach: SignalApproach = { signalId: "osm:node:1", approachId: "osm:node:1:LEFT", direction: 90, maneuver: "LEFT" };
    expect(await provider.getTiming(leftApproach, 1000)).toBeNull();
  });

  it("uses the dedicated LEFT signal group when one is actually present", async () => {
    const store = new SpatMessageStore();
    store.ingest({
      intersectionId: "osm:node:1",
      timestamp: 1000,
      signalGroups: [
        { signalGroupId: "g1", movement: "THROUGH", events: [{ state: "GREEN", minEndTime: 5000 }] },
        { signalGroupId: "g2", movement: "LEFT", events: [{ state: "RED", minEndTime: 9000 }] },
      ],
    });
    const provider = new SpatSignalTimingProvider(store);
    const leftApproach: SignalApproach = { signalId: "osm:node:1", approachId: "osm:node:1:LEFT", direction: 90, maneuver: "LEFT" };
    const evidence = await provider.getTiming(leftApproach, 1000);
    expect(evidence?.phase).toBe("RED");
    expect(evidence?.minEndTime).toBe(9000);
  });
});
