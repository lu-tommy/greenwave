# SPaT/MAP compatibility

What Green Wave's normalized signal model supports from the SAE J2735 SPaT/MAP standard family (as implemented by systems like USDOT V2X Hub — NTCIP 1202 → SAE J2735 SPaT), what it deliberately ignores, and how a real feed would map in. This is a **useful subset**, not a standards implementation — Green Wave does not parse ASN.1/UPER-encoded J2735 messages directly; it consumes an already-decoded, normalized JSON shape (see [Live SPaT ingestion contract](#live-spat-ingestion-contract)).

Green Wave does not have access to any live J2735 SPaT feed. See [`nyc-signal-data-research.md`](./nyc-signal-data-research.md) for what was investigated.

## What's supported

| J2735 SPaT concept | Green Wave type | Notes |
|---|---|---|
| `IntersectionState.id` | `SpatIntersectionState.intersectionId` | Mapped to our stable `osm:node:<id>` signal identity at ingestion — see [Signal identity](#signal-identity--intersection-ids) below. |
| `IntersectionState.moy`/`timeStamp` | `SpatIntersectionState.timestamp` | Epoch ms, not J2735's minute-of-year + millisecond pair — converted at the ingestion boundary. |
| `MovementState` (one per signal group/phase) | `SpatSignalGroup` | `signalGroupId` + `movement` (our `THROUGH`/`LEFT`/`RIGHT`/`U_TURN`/`UNKNOWN`, a simplification of J2735's fuller lane-connection model). |
| `MovementEvent.eventState` | `SpatEvent.state` | Collapsed to `GREEN`/`YELLOW`/`RED`/`UNKNOWN` — J2735 has finer-grained states (`protected-Movement-Allowed`, `permissive-clearance`, `stop-And-Remain`, etc.) that we bucket into these four. |
| `TimeChangeDetails.minEndTime` | `SpatEvent.minEndTime` | Required, as in J2735. |
| `TimeChangeDetails.likelyTime` | `SpatEvent.likelyEndTime` | Optional, as in J2735. |
| `TimeChangeDetails.maxEndTime` | `SpatEvent.maxEndTime` | Optional, as in J2735. |
| Per-message freshness / staleness | `SignalIntelligenceEngine`'s freshness policy | Not a J2735 field — our own safety layer on top, since J2735 doesn't mandate how a consumer should treat an old message. |

## What's deliberately ignored (for now)

- **MAP messages** (intersection lane geometry) — Green Wave uses OSM node locations + route geometry/maneuvers instead (see `SignalApproachResolver`). A real MAP feed would let approach/movement resolution be exact instead of inferred from route turns; that's a natural upgrade path, not implemented.
- **`TimeChangeDetails.timeConfidence`** — J2735 has a discrete confidence enum for the timing values themselves; we use one continuous `confidence` (0–1) on the whole evidence record instead.
- **`AdvisorySpeed`** — J2735 lets an intersection broadcast its own advisory speed; Green Wave always computes its own via `optimize()`/GLOSA rather than trusting a broadcast one, consistent with the "recommendedSpeed <= speedLimit" hard invariant living in our code, not the feed's.
- **`ConnectionManeuverAssist`, detector/queue data, pedestrian-specific signal groups, preemption/priority state** — not modeled. A pedestrian phase is out of scope for a speed advisory.
- **ASN.1/UPER binary encoding** — out of scope entirely. A real ingestion pipeline would decode J2735 upstream (e.g. with a library, or via something like V2X Hub / an ODE) and hand Green Wave the already-decoded JSON shape below.

## Live SPaT ingestion contract

`src/lib/signalIntelligence/spatIngestion.ts` accepts exactly this normalized shape:

```json
{
  "intersectionId": "osm:node:123456789",
  "timestamp": 1735689600000,
  "signalGroups": [
    {
      "signalGroupId": "g1",
      "movement": "THROUGH",
      "events": [
        { "state": "RED", "minEndTime": 1735689617000, "likelyEndTime": 1735689617000, "maxEndTime": 1735689619000 },
        { "state": "GREEN", "minEndTime": 1735689645000 }
      ]
    }
  ]
}
```

`parseSpatMessage()` validates this shape and throws a specific error on the first problem found (missing/wrong-typed field) rather than silently coercing bad data. There is **no HTTP write endpoint** for this in the app — per the project's safety rules, an unauthenticated public write path is not acceptable in production. A real integration would call `SpatMessageStore.ingest()` server-side (from a job that consumes a real feed and decodes/normalizes it into this shape); today, only tests and the replay fixtures in `spatReplay.test.ts` call it.

## Signal identity & intersection IDs

Green Wave's stable signal id is `osm:node:<OSM node id>`, chosen because that's what's available today (signal *location* discovery via OSM/Overpass). A real J2735 feed identifies intersections by its own `IntersectionID` (a small integer, regionally scoped by `RegionalID`), which won't match an OSM node id. Mapping between the two would need a lookup table (built once, e.g. by matching MAP message geometry to the nearest OSM node) — not implemented, but it's a single translation layer at the ingestion boundary, not a change to anything downstream (`SignalApproach`, `SignalTimingEvidence`, the fusion engine, the optimizer) — this is exactly the seam `SpatSignalTimingProvider` already sits behind.

## Why the optimizer doesn't need to change for a real feed

`optimize()` already consumes `SignalTimingEstimate` (min/likely/max window bounds + confidence), not a raw J2735 message — see `src/lib/optimizer/optimizer.ts`'s `SignalEstimateMap` parameter and `src/lib/signalIntelligence/glosaUncertainty.ts`. A real SPaT feed produces exactly this shape of evidence (arguably *more* precisely than our other sources). Plugging one in is: implement `getTiming()` against the real feed (mirroring `SpatSignalTimingProvider`), register it in the provider chain passed to `SignalIntelligenceEngine`, done.
