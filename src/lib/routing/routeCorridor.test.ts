import { describe, expect, it } from "vitest";
import { buildRouteCorridor } from "./routeCorridor";
import { buildMockDiscoveredSignals, buildMockRoute } from "./mockProviders";
import { StaticSignalTimingProvider } from "@/lib/providers/StaticSignalTimingProvider";
import type { Corridor, DiscoveredSignal } from "@/lib/types";

/** A timing provider that knows nothing — used to test "unknown" corridor construction without a fixture corridor. */
function nullTimingProvider() {
  const emptyCorridor: Corridor = {
    id: "empty",
    name: "empty",
    direction: "N/A",
    speedLimitMps: 10,
    polyline: [],
    intersections: [],
    dataSourceLabel: "SIMULATED SIGNAL DATA",
  };
  return new StaticSignalTimingProvider(emptyCorridor);
}

describe("buildRouteCorridor", () => {
  it("excludes low direction-confidence signals from the corridor entirely", async () => {
    const route = buildMockRoute();
    const discovered = buildMockDiscoveredSignals(route);
    const lowConfidenceCount = discovered.filter((s) => s.directionConfidence < 0.3).length;
    expect(lowConfidenceCount).toBeGreaterThan(0); // sanity: fixture actually has one

    const corridor = await buildRouteCorridor(route, discovered, nullTimingProvider());
    expect(corridor.intersections.length).toBe(discovered.length - lowConfidenceCount);
  });

  it("orders intersections by distance along the route", async () => {
    const route = buildMockRoute();
    const discovered = buildMockDiscoveredSignals(route);
    const corridor = await buildRouteCorridor(route, discovered, nullTimingProvider());
    const distances = corridor.intersections.map((i) => i.distanceAlongCorridorM);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("marks every intersection unknown (confidence 0) when the timing provider has no data", async () => {
    const route = buildMockRoute();
    const discovered = buildMockDiscoveredSignals(route);
    const corridor = await buildRouteCorridor(route, discovered, nullTimingProvider());
    for (const intersection of corridor.intersections) {
      expect(intersection.signalPlan).toBeNull();
      expect(intersection.confidence).toBe(0);
    }
  });

  it("clamps confidence to the direction confidence even if timing confidence is high", async () => {
    const route = buildMockRoute();
    const marginalSignal: DiscoveredSignal = {
      ...buildMockDiscoveredSignals(route)[0],
      directionConfidence: 0.4,
    };
    const knownPlan = { cycleSec: 60, greenSec: 28, yellowSec: 3, redSec: 29, offsetSec: 0 };
    const corridorWithTiming: Corridor = {
      id: "known",
      name: "known",
      direction: "N/A",
      speedLimitMps: 10,
      polyline: [],
      intersections: [
        {
          id: marginalSignal.id,
          name: "x",
          lat: 0,
          lng: 0,
          distanceAlongCorridorM: 0,
          signalPlan: knownPlan,
          confidence: 0.95,
        },
      ],
      dataSourceLabel: "SIMULATED SIGNAL DATA",
    };
    const provider = new StaticSignalTimingProvider(corridorWithTiming);

    const corridor = await buildRouteCorridor(route, [marginalSignal], provider);
    expect(corridor.intersections[0].confidence).toBeLessThanOrEqual(0.4);
  });

  it("produces a Corridor the existing optimizer can consume directly", async () => {
    const route = buildMockRoute();
    const discovered = buildMockDiscoveredSignals(route);
    const corridor = await buildRouteCorridor(route, discovered, nullTimingProvider());
    expect(corridor.speedLimitMps).toBeGreaterThan(0);
    expect(corridor.polyline.length).toBeGreaterThan(0);
    expect(corridor.dataSourceLabel).toMatch(/OSM/);
  });
});
