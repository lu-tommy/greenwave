import type { DiscoveredSignal, LatLng, Route } from "@/lib/types";

/**
 * Local-first caching for routes and discovered signal geometry. Route
 * fetches are cached briefly (traffic-aware routing can change); signal
 * geometry is far more static and cached much longer — see spec's
 * "Signal geometry is comparatively static and can be cached longer".
 */

const ROUTE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SIGNALS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function round(p: LatLng): string {
  return `${Math.round(p.lat * 1e4)},${Math.round(p.lng * 1e4)}`;
}

function routeCacheKey(origin: LatLng, destination: LatLng): string {
  return `greenwave:routeCache:${round(origin)}->${round(destination)}`;
}

function signalsCacheKey(routeHash: string): string {
  return `greenwave:signalsCache:${routeHash}`;
}

type CachedRoute = { route: Route; cachedAt: number };
type CachedSignals = { signals: DiscoveredSignal[]; cachedAt: number };

export function getCachedRoute(origin: LatLng, destination: LatLng): Route | null {
  if (!isStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(routeCacheKey(origin, destination));
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedRoute;
    if (Date.now() - cached.cachedAt > ROUTE_TTL_MS) return null;
    return cached.route;
  } catch {
    return null;
  }
}

export function setCachedRoute(origin: LatLng, destination: LatLng, route: Route): void {
  if (!isStorageAvailable()) return;
  try {
    const payload: CachedRoute = { route, cachedAt: Date.now() };
    window.localStorage.setItem(routeCacheKey(origin, destination), JSON.stringify(payload));
  } catch {
    // Storage full or unavailable — caching is an optimization, not a requirement.
  }
}

export function getCachedSignals(routeHash: string): DiscoveredSignal[] | null {
  if (!isStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(signalsCacheKey(routeHash));
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedSignals;
    if (Date.now() - cached.cachedAt > SIGNALS_TTL_MS) return null;
    return cached.signals;
  } catch {
    return null;
  }
}

export function setCachedSignals(routeHash: string, signals: DiscoveredSignal[]): void {
  if (!isStorageAvailable()) return;
  try {
    const payload: CachedSignals = { signals, cachedAt: Date.now() };
    window.localStorage.setItem(signalsCacheKey(routeHash), JSON.stringify(payload));
  } catch {
    // Storage full or unavailable — caching is an optimization, not a requirement.
  }
}
