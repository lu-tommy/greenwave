import { mphToMps } from "@/lib/geo/units";
import type { DestinationCandidate, LatLng, Route, RouteGeometry, RouteManeuver, RouteManeuverType, RouteStep, RoutingProvider } from "@/lib/types";
import { hashRoute } from "./routeUtils";

/** Conservative fallback speed limit (25 mph) used only when a step has no provider-supplied limit. Never a high invented default. */
const CONSERVATIVE_DEFAULT_SPEED_LIMIT_MPS = mphToMps(25);

type OsrmGeometry = { type: "LineString"; coordinates: [number, number][] };
type OsrmManeuver = { type: string; modifier?: string; location: [number, number] };
type OsrmStep = {
  maneuver: OsrmManeuver;
  distance: number;
  duration: number;
  geometry: OsrmGeometry;
  name?: string;
};
type OsrmLeg = { steps: OsrmStep[] };
type OsrmRoute = { geometry: OsrmGeometry; distance: number; duration: number; legs: OsrmLeg[] };

function toLatLng([lng, lat]: [number, number]): LatLng {
  return { lat, lng };
}

function toGeometry(g: OsrmGeometry): RouteGeometry {
  return g.coordinates.map(toLatLng);
}

const MANEUVER_TYPE_MAP: Record<string, RouteManeuverType> = {
  depart: "depart",
  turn: "turn",
  merge: "merge",
  roundabout: "roundabout",
  "roundabout turn": "roundabout",
  "exit roundabout": "roundabout",
  fork: "fork",
  continue: "continue",
  "new name": "continue",
  arrive: "arrive",
};

/** OSRM gives {type, modifier} rather than Mapbox's plain-English instruction string, so build a simple one. */
function buildInstruction(type: string, modifier?: string): string {
  const base = type === "depart" ? "Head" : type === "arrive" ? "Arrive" : type;
  return modifier ? `${base} ${modifier}`.trim() : base;
}

function toManeuver(m: OsrmManeuver): RouteManeuver {
  return {
    type: MANEUVER_TYPE_MAP[m.type] ?? "other",
    modifier: m.modifier,
    instruction: buildInstruction(m.type, m.modifier),
    location: toLatLng(m.location),
  };
}

function toStep(s: OsrmStep): RouteStep {
  return {
    maneuver: toManeuver(s.maneuver),
    distanceM: s.distance,
    durationSec: s.duration,
    geometry: toGeometry(s.geometry),
    roadName: s.name || undefined,
  };
}

/**
 * Calls this app's own /api/routing/* server routes, which in turn call
 * the public OSRM (routing) and Nominatim (geocoding) servers — both
 * open-source, key-free, and free to use. No account or credit card
 * required anywhere in this path. See README for self-hosting notes if
 * you outgrow the public demo servers' fair-use limits.
 */
export class OsrmRoutingProvider implements RoutingProvider {
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

  async getRoute(origin: LatLng, destination: LatLng): Promise<Route> {
    const url = new URL("/api/routing/directions", window.location.origin);
    url.searchParams.set("originLat", String(origin.lat));
    url.searchParams.set("originLng", String(origin.lng));
    url.searchParams.set("destLat", String(destination.lat));
    url.searchParams.set("destLng", String(destination.lng));

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new RoutingUnavailableError(body.error ?? `directions failed (${res.status})`);
    }
    const data = await res.json();
    const osrmRoute = data.route as OsrmRoute;
    const geometry = toGeometry(osrmRoute.geometry);
    const steps = osrmRoute.legs.flatMap((leg) => leg.steps.map(toStep));

    return {
      id: crypto.randomUUID(),
      origin,
      destination,
      destinationLabel: "",
      geometry,
      distanceM: osrmRoute.distance,
      durationSec: osrmRoute.duration,
      steps,
      defaultSpeedLimitMps: CONSERVATIVE_DEFAULT_SPEED_LIMIT_MPS,
      routeHash: hashRoute(origin, destination, geometry),
      fetchedAt: Date.now(),
    };
  }
}

/** Thrown when routing can't proceed (upstream failure, rate limit) — UI shows a clear error state, never a crash. */
export class RoutingUnavailableError extends Error {}
