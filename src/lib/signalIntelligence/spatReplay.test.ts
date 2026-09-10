import { describe, expect, it } from "vitest";
import { SpatMessageStore, SpatSignalTimingProvider } from "./spatIngestion";
import { SignalIntelligenceEngine } from "./SignalIntelligenceEngine";
import { computeTimeToGreen } from "./timeToGreen";
import { estimateArrivalUncertaintySec, robustGreenScore } from "./glosaUncertainty";
import type { SignalApproach } from "@/lib/types";

/**
 * Proves the whole Signal Intelligence pipeline against REPLAYED SPaT
 * messages — no live feed exists, but this demonstrates the architecture
 * end to end exactly as it would behave with one: ingest -> fuse ->
 * Time-to-Green -> GLOSA -> freshness/confidence, all driven by a
 * simulated clock (never wall-clock time), the same way the drive
 * simulator already works for the deterministic engine.
 */

const APPROACH: SignalApproach = { signalId: "osm:node:42", approachId: "osm:node:42:THROUGH", direction: 90, maneuver: "THROUGH" };

describe("SPaT replay: signal changes -> Time-to-Green -> GLOSA -> freshness, end to end", () => {
  it("walks a full red -> green -> red cycle via replayed messages and reacts correctly at each simulated moment", async () => {
    const store = new SpatMessageStore();
    const engine = new SignalIntelligenceEngine([new SpatSignalTimingProvider(store)]);
    const STOPPED = 0;

    // t=0: freshly ingested message says RED, green likely in 17s.
    let simClock = 0;
    store.ingest({
      intersectionId: APPROACH.signalId,
      timestamp: simClock,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "RED", minEndTime: 17_000, likelyEndTime: 17_000 }] }],
    });

    let result = await engine.evaluate(APPROACH, simClock);
    expect(result.tier).toBe("HIGH");
    let ttg = computeTimeToGreen(result, STOPPED, simClock);
    expect(ttg).toEqual({ status: "COUNTDOWN", secondsToGreen: 17 });

    // t=6s: a real live feed re-confirms the same predicted transition with
    // a fresh observedAt — OFFICIAL_LIVE's freshness window (hard expiry
    // 8s) means a single stale message can't carry the whole approach, so
    // replay re-ingests periodically exactly as a real feed would push updates.
    simClock = 6000;
    store.ingest({
      intersectionId: APPROACH.signalId,
      timestamp: simClock,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "RED", minEndTime: 17_000, likelyEndTime: 17_000 }] }],
    });
    result = await engine.evaluate(APPROACH, simClock);
    ttg = computeTimeToGreen(result, STOPPED, simClock);
    expect(ttg).toEqual({ status: "COUNTDOWN", secondsToGreen: 11 });

    // t=10s: another fresh re-confirmation, still comfortably outside the watch cutoff.
    simClock = 10_000;
    store.ingest({
      intersectionId: APPROACH.signalId,
      timestamp: simClock,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "RED", minEndTime: 17_000, likelyEndTime: 17_000 }] }],
    });
    result = await engine.evaluate(APPROACH, simClock);
    ttg = computeTimeToGreen(result, STOPPED, simClock);
    expect(ttg).toEqual({ status: "COUNTDOWN", secondsToGreen: 7 });

    // t=13.5s (no new message needed — still within the fresh window): now
    // within the 5s safety cutoff — must switch to WATCH_SIGNAL, never count to 0.
    simClock = 13_500;
    result = await engine.evaluate(APPROACH, simClock);
    ttg = computeTimeToGreen(result, STOPPED, simClock);
    expect(ttg.status).toBe("WATCH_SIGNAL");

    // t=17.5s: a fresh message confirms the signal actually turned GREEN.
    simClock = 17_500;
    store.ingest({
      intersectionId: APPROACH.signalId,
      timestamp: simClock,
      signalGroups: [{ signalGroupId: "g1", movement: "THROUGH", events: [{ state: "GREEN", minEndTime: 45_000, likelyEndTime: 45_000 }] }],
    });
    result = await engine.evaluate(APPROACH, simClock);
    expect(result.estimate?.phase).toBe("GREEN");
    // No longer "time to green" — the signal is already green.
    ttg = computeTimeToGreen(result, STOPPED, simClock);
    expect(ttg.status).toBe("UNAVAILABLE");

    // GLOSA: an approaching vehicle arriving mid-green should score robustly positive.
    const arrivalDuringGreen = simClock + 10_000;
    const uncertaintySec = estimateArrivalUncertaintySec(10, 10, 8);
    const glosaScore = robustGreenScore(result.estimate!, arrivalDuringGreen, uncertaintySec);
    expect(glosaScore).toBeGreaterThan(0);

    // t = 17.5s + 20s = 37.5s, no new message ingested for 20s: OFFICIAL_LIVE
    // has hard-expired (8s policy) — the fusion engine must drop it entirely
    // rather than keep reporting a now-untrustworthy "green".
    simClock = 37_500;
    result = await engine.evaluate(APPROACH, simClock);
    expect(result.tier).toBe("UNAVAILABLE");
    expect(result.estimate).toBeNull();
    ttg = computeTimeToGreen(result, STOPPED, simClock);
    expect(ttg.status).toBe("UNAVAILABLE");
  });

  it("never produces a GLOSA/Time-to-Green result once ingestion stops entirely (architecture works with zero live sources, as designed)", async () => {
    const engine = new SignalIntelligenceEngine([new SpatSignalTimingProvider(new SpatMessageStore())]);
    const result = await engine.evaluate(APPROACH, 0);
    expect(result.tier).toBe("UNAVAILABLE");
    expect(computeTimeToGreen(result, 0, 0)).toEqual({ status: "UNAVAILABLE" });
  });
});
