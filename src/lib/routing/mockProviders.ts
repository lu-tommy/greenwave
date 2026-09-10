import { mphToMps } from "@/lib/geo/units";
import { hashRoute } from "./routeUtils";
import type {
  DestinationCandidate,
  DiscoveredSignal,
  LatLng,
  Route,
  RoutingProvider,
  TrafficSignalDiscoveryProvider,
} from "@/lib/types";

/**
 * Deterministic, network-free fixtures for tests (and for exercising the
 * full destination -> route -> discovery -> corridor pipeline without a
 * Mapbox token or live Overpass access). Never used in production code
 * paths — only by tests and dev tooling.
 */

const MOCK_ORIGIN: LatLng = { lat: 39.7392, lng: -104.9903 };
const MOCK_DESTINATION: LatLng = { lat: 39.7392, lng: -104.978 };

function buildMockGeometry(): LatLng[] {
  const points: LatLng[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    points.push({ lat: MOCK_ORIGIN.lat, lng: MOCK_ORIGIN.lng + t * (MOCK_DESTINATION.lng - MOCK_ORIGIN.lng) });
  }
  return points;
}

export function buildMockRoute(): Route {
  const geometry = buildMockGeometry();
  return {
    id: "mock-route-1",
    origin: MOCK_ORIGIN,
    destination: MOCK_DESTINATION,
    destinationLabel: "Mock Destination",
    geometry,
    distanceM: 1200,
    durationSec: 240,
    steps: [
      {
        maneuver: { type: "depart", instruction: "Head east", location: MOCK_ORIGIN },
        distanceM: 1200,
        durationSec: 240,
        geometry,
        roadName: "Mock Ave",
      },
      {
        maneuver: { type: "arrive", instruction: "Arrive at destination", location: MOCK_DESTINATION },
        distanceM: 0,
        durationSec: 0,
        geometry: [MOCK_DESTINATION],
      },
    ],
    defaultSpeedLimitMps: mphToMps(25),
    routeHash: hashRoute(MOCK_ORIGIN, MOCK_DESTINATION, geometry),
    fetchedAt: Date.now(),
  };
}

/** 6 signals: mostly high-confidence "known route direction", one low-confidence (crossing-street-ish), spread along the mock route. */
export function buildMockDiscoveredSignals(route: Route = buildMockRoute()): DiscoveredSignal[] {
  const now = Date.now();
  const distances = [150, 350, 520, 700, 850, 1000];
  return distances.map((d, idx) => {
    const t = d / route.distanceM;
    const lng = route.origin.lng + t * (route.destination.lng - route.origin.lng);
    return {
      id: `osm:node:mock-${idx + 1}`,
      lat: route.origin.lat,
      lng,
      distanceAlongRouteM: d,
      perpendicularDistanceM: idx === 3 ? 28 : 3, // index 3 is a marginal, low-confidence candidate
      routeHeadingDeg: 90,
      directionConfidence: idx === 3 ? 0.25 : 0.8,
      roadName: `Mock Cross St ${idx + 1}`,
      intersectionName: `Mock Cross St ${idx + 1}`,
      metadata: { highway: "traffic_signals" },
      firstSeen: now,
      lastSeen: now,
    };
  });
}

export class MockRoutingProvider implements RoutingProvider {
  constructor(
    private readonly route: Route = buildMockRoute(),
    private readonly destinations: DestinationCandidate[] = [
      { id: "mock-dest-1", name: "Mock Destination", description: "123 Mock Ave, Testville", location: MOCK_DESTINATION },
    ],
  ) {}

  async searchDestination(): Promise<DestinationCandidate[]> {
    return this.destinations;
  }

  async getRoute(): Promise<Route> {
    return this.route;
  }
}

export class MockTrafficSignalDiscoveryProvider implements TrafficSignalDiscoveryProvider {
  constructor(private readonly signals: DiscoveredSignal[] = buildMockDiscoveredSignals()) {}

  async getSignalsNearRoute(): Promise<DiscoveredSignal[]> {
    return this.signals;
  }
}
