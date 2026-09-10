import { describe, expect, it } from "vitest";
import { combinedApproachConfidence, resolveApproach } from "./approachResolver";
import { buildMockRoute } from "@/lib/routing/mockProviders";
import type { DiscoveredSignal, Route } from "@/lib/types";

function makeSignal(overrides: Partial<DiscoveredSignal>): DiscoveredSignal {
  return {
    id: "osm:node:1",
    lat: 0,
    lng: 0,
    distanceAlongRouteM: 100,
    perpendicularDistanceM: 3,
    routeHeadingDeg: 90,
    directionConfidence: 0.8,
    firstSeen: 0,
    lastSeen: 0,
    ...overrides,
  };
}

describe("resolveApproach", () => {
  it("defaults to THROUGH for a signal with no nearby turn maneuver", () => {
    const route = buildMockRoute(); // straight depart -> arrive, no turns
    const signal = makeSignal({ distanceAlongRouteM: 200 });
    const { approach, movementConfidence } = resolveApproach(signal, route);
    expect(approach.maneuver).toBe("THROUGH");
    expect(approach.approachId).toBe(`${signal.id}:THROUGH`);
    expect(movementConfidence).toBeGreaterThan(0);
  });

  it("resolves LEFT when a left-turn maneuver is right at the signal's position", () => {
    const route: Route = {
      ...buildMockRoute(),
      steps: [
        {
          maneuver: { type: "depart", instruction: "Head east", location: { lat: 0, lng: 0 } },
          distanceM: 100,
          durationSec: 20,
          geometry: [{ lat: 0, lng: 0 }],
          roadName: "Mock Ave",
        },
        {
          maneuver: { type: "turn", modifier: "left", instruction: "Turn left", location: { lat: 0, lng: 0.001 } },
          distanceM: 100,
          durationSec: 20,
          geometry: [{ lat: 0, lng: 0.001 }],
          roadName: "Mock St",
        },
        {
          maneuver: { type: "arrive", instruction: "Arrive", location: { lat: 0, lng: 0.002 } },
          distanceM: 0,
          durationSec: 0,
          geometry: [{ lat: 0, lng: 0.002 }],
        },
      ],
    };
    const signal = makeSignal({ distanceAlongRouteM: 100 }); // right at the start of the turn step
    const { approach, movementConfidence } = resolveApproach(signal, route);
    expect(approach.maneuver).toBe("LEFT");
    expect(movementConfidence).toBeGreaterThan(0.7);
  });

  it("resolves RIGHT similarly for a right-turn maneuver", () => {
    const route: Route = {
      ...buildMockRoute(),
      steps: [
        {
          maneuver: { type: "depart", instruction: "Head east", location: { lat: 0, lng: 0 } },
          distanceM: 200,
          durationSec: 20,
          geometry: [{ lat: 0, lng: 0 }],
        },
        {
          maneuver: { type: "turn", modifier: "right", instruction: "Turn right", location: { lat: 0, lng: 0.002 } },
          distanceM: 100,
          durationSec: 20,
          geometry: [{ lat: 0, lng: 0.002 }],
        },
      ],
    };
    const signal = makeSignal({ distanceAlongRouteM: 200 });
    const { approach } = resolveApproach(signal, route);
    expect(approach.maneuver).toBe("RIGHT");
  });

  it("does not confuse a distant maneuver with the signal's actual movement", () => {
    const route: Route = {
      ...buildMockRoute(),
      steps: [
        {
          maneuver: { type: "depart", instruction: "Head east", location: { lat: 0, lng: 0 } },
          distanceM: 1000,
          durationSec: 100,
          geometry: [{ lat: 0, lng: 0 }],
        },
        {
          maneuver: { type: "turn", modifier: "left", instruction: "Turn left", location: { lat: 0, lng: 0.01 } },
          distanceM: 100,
          durationSec: 20,
          geometry: [{ lat: 0, lng: 0.01 }],
        },
      ],
    };
    // Signal is only 100m in, but the only turn is 1000m in — far outside tolerance.
    const signal = makeSignal({ distanceAlongRouteM: 100 });
    const { approach } = resolveApproach(signal, route);
    expect(approach.maneuver).toBe("THROUGH");
  });
});

describe("combinedApproachConfidence", () => {
  it("is limited by the weaker of direction confidence and movement confidence", () => {
    const route = buildMockRoute();
    const signal = makeSignal({ directionConfidence: 0.5 });
    const resolution = resolveApproach(signal, route);
    const combined = combinedApproachConfidence(signal, resolution);
    expect(combined).toBeLessThanOrEqual(0.5);
    expect(combined).toBeLessThanOrEqual(resolution.movementConfidence);
  });
});
