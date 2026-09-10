import { projectOntoPolyline } from "@/lib/geo/distance";
import { downsampleGeometry } from "@/lib/routing/routeUtils";
import type { DiscoveredSignal, LatLng, Route, TrafficSignalDiscoveryProvider } from "@/lib/types";

/**
 * Signals farther than this from the route line are almost certainly on a
 * different street (crossing road, parallel service road, etc.) and are
 * rejected outright rather than kept with low confidence.
 */
const REJECT_PERPENDICULAR_M = 35;
/** Signals this close together along the route are treated as one physical intersection (multiple OSM nodes per crosswalk arm are common). */
const DEDUPE_DISTANCE_M = 15;
const QUERY_RADIUS_M = 40;
const DOWNSAMPLE_SPACING_M = 60;

const COMPASS_DEG: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

function angularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Estimates confidence that a discovered signal applies to travel in the
 * route's direction at this point, using whatever OSM direction metadata is
 * available. This is a heuristic, not ground truth — OSM tagging for signal
 * direction is inconsistent. When genuinely uncertain we say so via a
 * moderate/low score rather than assuming applicability.
 */
export function estimateDirectionConfidence(tags: Record<string, string>, routeHeadingDeg: number, perpendicularDistanceM: number): number {
  const raw = tags["traffic_signals:direction"] ?? tags["direction"];
  if (raw) {
    const numeric = Number(raw);
    let bearing: number | null = null;
    if (Number.isFinite(numeric)) {
      bearing = numeric;
    } else if (raw.toUpperCase() in COMPASS_DEG) {
      bearing = COMPASS_DEG[raw.toUpperCase()];
    }
    if (bearing != null) {
      const diff = angularDiff(bearing, routeHeadingDeg);
      return diff <= 90 ? 0.85 : 0.15;
    }
    // "forward"/"backward" relative to the OSM way's own digitization order —
    // meaningful only with the way geometry, which we don't fetch in V1.
    if (raw === "forward" || raw === "backward" || raw === "both") return 0.5;
  }
  // No direction metadata at all: fall back to proximity as a weak signal —
  // closer to the route centerline is somewhat more likely to be ours, but
  // this is genuinely uncertain, so cap it well short of "confident".
  const proximityScore = 1 - perpendicularDistanceM / REJECT_PERPENDICULAR_M;
  return Math.max(0.3, Math.min(0.55, 0.3 + proximityScore * 0.25));
}

type OverpassSignal = { osmId: number; lat: number; lng: number; tags: Record<string, string> };

export class OsmTrafficSignalDiscoveryProvider implements TrafficSignalDiscoveryProvider {
  async getSignalsNearRoute(route: Route): Promise<DiscoveredSignal[]> {
    const points = downsampleGeometry(route.geometry, DOWNSAMPLE_SPACING_M, 400);
    if (points.length === 0) return [];

    const res = await fetch("/api/signals/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points, radiusM: QUERY_RADIUS_M }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new SignalDiscoveryUnavailableError(body.error ?? `signal discovery failed (${res.status})`);
    }

    const data = await res.json();
    const rawSignals = (data.signals ?? []) as OverpassSignal[];
    const now = Date.now();

    const candidates: DiscoveredSignal[] = [];
    for (const s of rawSignals) {
      const point: LatLng = { lat: s.lat, lng: s.lng };
      const projection = projectOntoPolyline(point, route.geometry);
      if (projection.offsetM > REJECT_PERPENDICULAR_M) continue; // different street

      const directionConfidence = estimateDirectionConfidence(s.tags, projection.segmentBearingDeg, projection.offsetM);

      candidates.push({
        id: `osm:node:${s.osmId}`,
        lat: s.lat,
        lng: s.lng,
        distanceAlongRouteM: projection.distanceAlongM,
        perpendicularDistanceM: projection.offsetM,
        routeHeadingDeg: projection.segmentBearingDeg,
        directionConfidence,
        roadName: s.tags.name ?? undefined,
        intersectionName: s.tags.name ?? undefined,
        metadata: s.tags,
        firstSeen: now,
        lastSeen: now,
      });
    }

    candidates.sort((a, b) => a.distanceAlongRouteM - b.distanceAlongRouteM);
    return dedupe(candidates);
  }
}

/** Merges signals that are close together along the route into one, keeping the best-evidenced candidate. */
export function dedupe(signals: DiscoveredSignal[]): DiscoveredSignal[] {
  const out: DiscoveredSignal[] = [];
  for (const signal of signals) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(signal.distanceAlongRouteM - prev.distanceAlongRouteM) < DEDUPE_DISTANCE_M) {
      if (signal.directionConfidence > prev.directionConfidence) out[out.length - 1] = signal;
      continue;
    }
    out.push(signal);
  }
  return out;
}

export class SignalDiscoveryUnavailableError extends Error {}
