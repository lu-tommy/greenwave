import type { LatLng } from "@/lib/types";

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters. */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

/** Cumulative distance (meters) along a polyline, one entry per vertex, starting at 0. */
export function cumulativeDistances(polyline: LatLng[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < polyline.length; i++) {
    out.push(out[i - 1] + haversineDistance(polyline[i - 1], polyline[i]));
  }
  return out;
}

export function totalPolylineLength(polyline: LatLng[]): number {
  const dists = cumulativeDistances(polyline);
  return dists[dists.length - 1] ?? 0;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolates a point at a given distance (meters) along the polyline. */
export function pointAtDistance(polyline: LatLng[], distanceM: number): LatLng {
  if (polyline.length === 0) throw new Error("pointAtDistance: empty polyline");
  if (polyline.length === 1) return polyline[0];

  const cum = cumulativeDistances(polyline);
  const total = cum[cum.length - 1];
  const clamped = Math.max(0, Math.min(distanceM, total));

  for (let i = 1; i < cum.length; i++) {
    if (clamped <= cum[i]) {
      const segLen = cum[i] - cum[i - 1];
      const t = segLen === 0 ? 0 : (clamped - cum[i - 1]) / segLen;
      return {
        lat: lerp(polyline[i - 1].lat, polyline[i].lat, t),
        lng: lerp(polyline[i - 1].lng, polyline[i].lng, t),
      };
    }
  }
  return polyline[polyline.length - 1];
}

export type ProjectionResult = {
  /** Distance along the corridor (meters) of the closest point on the polyline. */
  distanceAlongM: number;
  /** Perpendicular distance (meters) from the query point to the polyline. */
  offsetM: number;
  /** Unit-ish bearing of the segment the point projected onto, in degrees (0 = north). */
  segmentBearingDeg: number;
};

/**
 * Projects an arbitrary point onto the polyline, returning how far along the
 * corridor the closest point is and how far off the corridor the query
 * point is. Uses a local equirectangular approximation per-segment, which is
 * accurate enough for corridor-scale (sub-few-km) distances.
 */
export function projectOntoPolyline(point: LatLng, polyline: LatLng[]): ProjectionResult {
  if (polyline.length < 2) {
    const dist = polyline.length === 1 ? haversineDistance(point, polyline[0]) : 0;
    return { distanceAlongM: 0, offsetM: dist, segmentBearingDeg: 0 };
  }

  const cum = cumulativeDistances(polyline);
  let best: ProjectionResult = { distanceAlongM: 0, offsetM: Infinity, segmentBearingDeg: 0 };

  const refLat = toRad(polyline[0].lat);
  const metersPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const metersPerDegLng = metersPerDegLat * Math.cos(refLat);

  const toXY = (p: LatLng) => ({ x: p.lng * metersPerDegLng, y: p.lat * metersPerDegLat });

  const px = toXY(point);

  for (let i = 1; i < polyline.length; i++) {
    const a = toXY(polyline[i - 1]);
    const b = toXY(polyline[i]);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const segLenSq = abx * abx + aby * aby;

    let t = segLenSq === 0 ? 0 : ((px.x - a.x) * abx + (px.y - a.y) * aby) / segLenSq;
    t = Math.max(0, Math.min(1, t));

    const closest = { x: a.x + abx * t, y: a.y + aby * t };
    const offset = Math.hypot(px.x - closest.x, px.y - closest.y);

    if (offset < best.offsetM) {
      const segLen = cum[i] - cum[i - 1];
      const bearing = (Math.atan2(abx, aby) * 180) / Math.PI;
      best = {
        distanceAlongM: cum[i - 1] + t * segLen,
        offsetM: offset,
        segmentBearingDeg: (bearing + 360) % 360,
      };
    }
  }

  return best;
}
