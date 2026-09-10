import { mphToMps } from "@/lib/geo/units";
import type { DestinationCandidate, LatLng, Route, RouteGeometry, RouteManeuver, RouteManeuverType, RouteStep, RoutingProvider } from "@/lib/types";
import { hashRoute } from "./routeUtils";

/** Conservative fallback speed limit (25 mph) used only when a step has no provider-supplied limit. Never a high invented default. */
const CONSERVATIVE_DEFAULT_SPEED_LIMIT_MPS = mphToMps(25);

type MapboxGeometry = { type: "LineString"; coordinates: [number, number][] };
type MapboxManeuver = { type: string; modifier?: string; instruction: string; location: [number, number] };
type MapboxStep = {
  maneuver: MapboxManeuver;
  distance: number;
  duration: number;
  geometry: MapboxGeometry;
  name?: string;
};
type MapboxLeg = { steps: MapboxStep[] };
type MapboxRoute = { geometry: MapboxGeometry; distance: number; duration: number; legs: MapboxLeg[] };

function toLatLng([lng, lat]: [number, number]): LatLng {
  return { lat, lng };
}

function toGeometry(g: MapboxGeometry): RouteGeometry {
  return g.coordinates.map(toLatLng);
}

const MANEUVER_TYPE_MAP: Record<string, RouteManeuverType> = {
  depart: "depart",
  turn: "turn",
  merge: "merge",
  roundabout: "roundabout",
  "roundabout turn": "roundabout",
  fork: "fork",
  continue: "continue",
  arrive: "arrive",
};

function toManeuver(m: MapboxManeuver): RouteManeuver {
  return {
    type: MANEUVER_TYPE_MAP[m.type] ?? "other",
    modifier: m.modifier,
    instruction: m.instruction,
    location: toLatLng(m.location),
  };
}

function toStep(s: MapboxStep): RouteStep {
  return {
    maneuver: toManeuver(s.maneuver),
    distanceM: s.distance,
    durationSec: s.duration,
    geometry: toGeometry(s.geometry),
    roadName: s.name || undefined,
  };
}

/**
 * Calls this app's own /api/routing/* server routes (never Mapbox directly)
 * so the access token stays server-side. If those routes report the token
 * is missing, callers get a typed error they can render as a clear
 * "routing unavailable" state rather than crashing.
 */
export class MapboxRoutingProvider implements RoutingProvider {
  async searchDestination(query: string, proximity?: LatLng): Promise<DestinationCandidate[]> {
    if (!query.trim()) return [];
    const url = new URL("/api/routing/search", window.location.origin);
    url.searchParams.set("q", query);
    if (proximity) {
      url.searchParams.set("lat", String(proximity.lat));
      url.searchParams.set("lng", String(proximity.lng));
    }
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new RoutingUnavailableError(body.error ?? `search failed (${res.status})`);
    }
    const data = await res.json();
    return data.candidates as DestinationCandidate[];
  }

  async getRoute(origin: LatLng, destination: LatLng, options?: { profile?: "driving" | "driving-traffic" }): Promise<Route> {
    const url = new URL("/api/routing/directions", window.location.origin);
    url.searchParams.set("originLat", String(origin.lat));
    url.searchParams.set("originLng", String(origin.lng));
    url.searchParams.set("destLat", String(destination.lat));
    url.searchParams.set("destLng", String(destination.lng));
    if (options?.profile) url.searchParams.set("profile", options.profile);

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new RoutingUnavailableError(body.error ?? `directions failed (${res.status})`);
    }
    const data = await res.json();
    const mapboxRoute = data.route as MapboxRoute;
    const geometry = toGeometry(mapboxRoute.geometry);
    const steps = mapboxRoute.legs.flatMap((leg) => leg.steps.map(toStep));

    return {
      id: crypto.randomUUID(),
      origin,
      destination,
      destinationLabel: "",
      geometry,
      distanceM: mapboxRoute.distance,
      durationSec: mapboxRoute.duration,
      steps,
      defaultSpeedLimitMps: CONSERVATIVE_DEFAULT_SPEED_LIMIT_MPS,
      routeHash: hashRoute(origin, destination, geometry),
      fetchedAt: Date.now(),
    };
  }
}

/** Thrown when routing can't proceed (missing token, upstream failure) — UI shows a clear setup/error state, never a crash. */
export class RoutingUnavailableError extends Error {}
