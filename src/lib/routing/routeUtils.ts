import type { LatLng, Route, RouteGeometry } from "@/lib/types";

/** Small deterministic string hash (FNV-1a) — good enough for cache keys/route identity, not cryptographic. */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function hashRoute(origin: LatLng, destination: LatLng, geometry: RouteGeometry): string {
  const sample = geometry.length <= 20 ? geometry : geometry.filter((_, i) => i % Math.ceil(geometry.length / 20) === 0);
  const key = JSON.stringify({ o: round(origin), d: round(destination), g: sample.map(round) });
  return hashString(key);
}

function round(p: LatLng): [number, number] {
  return [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lng * 1e5) / 1e5];
}

/**
 * Downsamples route geometry to roughly one point every `spacingM` meters
 * (using straight-line approximation between consecutive vertices), capped
 * at `maxPoints`. Used to keep the Overpass "around" query small instead of
 * sending every raw geometry vertex.
 */
export function downsampleGeometry(geometry: RouteGeometry, spacingM: number, maxPoints: number): LatLng[] {
  if (geometry.length === 0) return [];
  const out: LatLng[] = [geometry[0]];
  let accum = 0;
  for (let i = 1; i < geometry.length; i++) {
    const d = haversineApprox(geometry[i - 1], geometry[i]);
    accum += d;
    if (accum >= spacingM) {
      out.push(geometry[i]);
      accum = 0;
    }
    if (out.length >= maxPoints) break;
  }
  const last = geometry[geometry.length - 1];
  if (out[out.length - 1] !== last && out.length < maxPoints) out.push(last);
  return out;
}

function haversineApprox(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Bounding box padded by `paddingM`, for coarse pre-filtering before precise per-point checks. */
export function boundingBox(points: LatLng[], paddingM: number) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const latPad = paddingM / 111_320;
  const lngPad = paddingM / (111_320 * Math.cos((points[0].lat * Math.PI) / 180));
  return {
    minLat: Math.min(...lats) - latPad,
    maxLat: Math.max(...lats) + latPad,
    minLng: Math.min(...lngs) - lngPad,
    maxLng: Math.max(...lngs) + lngPad,
  };
}

export function isSameRoute(a: Route | null, b: Route | null): boolean {
  if (!a || !b) return a === b;
  return a.routeHash === b.routeHash;
}
