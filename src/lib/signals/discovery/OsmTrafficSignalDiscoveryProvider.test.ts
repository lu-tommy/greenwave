import { afterEach, describe, expect, it, vi } from "vitest";
import { OsmTrafficSignalDiscoveryProvider, dedupe, estimateDirectionConfidence } from "./OsmTrafficSignalDiscoveryProvider";
import { buildMockRoute } from "@/lib/routing/mockProviders";
import type { DiscoveredSignal } from "@/lib/types";

function makeSignal(overrides: Partial<DiscoveredSignal>): DiscoveredSignal {
  return {
    id: "osm:node:1",
    lat: 0,
    lng: 0,
    distanceAlongRouteM: 100,
    perpendicularDistanceM: 5,
    routeHeadingDeg: 90,
    directionConfidence: 0.8,
    firstSeen: 0,
    lastSeen: 0,
    ...overrides,
  };
}

describe("estimateDirectionConfidence", () => {
  it("gives high confidence when a numeric direction tag closely matches the route heading", () => {
    const conf = estimateDirectionConfidence({ "traffic_signals:direction": "92" }, 90, 5);
    expect(conf).toBeGreaterThan(0.7);
  });

  it("gives low confidence when a numeric direction tag opposes the route heading", () => {
    const conf = estimateDirectionConfidence({ direction: "270" }, 90, 5);
    expect(conf).toBeLessThan(0.3);
  });

  it("gives moderate confidence for a compass-word direction aligned with the route", () => {
    const conf = estimateDirectionConfidence({ direction: "E" }, 90, 5);
    expect(conf).toBeGreaterThan(0.7);
  });

  it("never returns a high-certainty score when there is no direction metadata at all", () => {
    const conf = estimateDirectionConfidence({}, 90, 5);
    expect(conf).toBeLessThan(0.6);
  });

  it("gives a lower proximity-based score the farther the signal is from the route line", () => {
    const near = estimateDirectionConfidence({}, 90, 2);
    const far = estimateDirectionConfidence({}, 90, 30);
    expect(near).toBeGreaterThanOrEqual(far);
  });
});

describe("dedupe", () => {
  it("merges signals within the dedupe distance, keeping the higher-confidence one", () => {
    const signals = [
      makeSignal({ id: "a", distanceAlongRouteM: 100, directionConfidence: 0.3 }),
      makeSignal({ id: "b", distanceAlongRouteM: 105, directionConfidence: 0.9 }),
    ];
    const result = dedupe(signals);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("keeps signals that are far apart along the route as separate entries", () => {
    const signals = [
      makeSignal({ id: "a", distanceAlongRouteM: 100 }),
      makeSignal({ id: "b", distanceAlongRouteM: 500 }),
    ];
    expect(dedupe(signals)).toHaveLength(2);
  });
});

describe("OsmTrafficSignalDiscoveryProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects candidates farther than the perpendicular-distance threshold and assigns stable osm:node ids", async () => {
    const route = buildMockRoute();
    const onRoutePoint = route.geometry[5];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        signals: [
          { osmId: 111, lat: onRoutePoint.lat, lng: onRoutePoint.lng, tags: { highway: "traffic_signals" } },
          { osmId: 222, lat: onRoutePoint.lat + 0.01, lng: onRoutePoint.lng, tags: { highway: "traffic_signals" } }, // ~1.1km away — different street
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OsmTrafficSignalDiscoveryProvider();
    const results = await provider.getSignalsNearRoute(route);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("osm:node:111");
  });

  it("throws a typed, catchable error when the discovery endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: "Overpass busy" }) }),
    );
    const provider = new OsmTrafficSignalDiscoveryProvider();
    await expect(provider.getSignalsNearRoute(buildMockRoute())).rejects.toThrow(/Overpass busy/);
  });
});
