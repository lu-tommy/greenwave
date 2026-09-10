import type { Corridor, SignalPlan } from "@/lib/types";

/**
 * Local persistence for manually-edited signal timing (the calibration
 * editor). V1 keeps this in localStorage, keyed by corridor id. Overrides
 * are merged on top of the corridor's built-in demo defaults at read time,
 * so "Reset to demo defaults" is just "clear the override".
 */

export type SignalOverride = SignalPlan & { confidence: number };
type OverrideMap = Record<string, SignalOverride>; // intersectionId -> override

/**
 * Shared calibration namespace for real-world (route-discovered) signals.
 * Deliberately NOT the route hash — a physical signal encountered on two
 * different routes should reuse the same manual override, since it's the
 * same intersection either way.
 */
export const REAL_WORLD_CALIBRATION_NAMESPACE = "real-world-signals";

function storageKey(corridorId: string): string {
  return `greenwave:calibration:${corridorId}`;
}

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadOverrides(corridorId: string): OverrideMap {
  if (!isStorageAvailable()) return {};
  try {
    const raw = window.localStorage.getItem(storageKey(corridorId));
    if (!raw) return {};
    return JSON.parse(raw) as OverrideMap;
  } catch {
    return {};
  }
}

export function getManualOverride(corridorId: string, intersectionId: string): SignalOverride | undefined {
  return loadOverrides(corridorId)[intersectionId];
}

export function saveOverride(corridorId: string, intersectionId: string, override: SignalOverride): void {
  if (!isStorageAvailable()) return;
  const current = loadOverrides(corridorId);
  current[intersectionId] = override;
  window.localStorage.setItem(storageKey(corridorId), JSON.stringify(current));
}

export function clearOverride(corridorId: string, intersectionId: string): void {
  if (!isStorageAvailable()) return;
  const current = loadOverrides(corridorId);
  delete current[intersectionId];
  window.localStorage.setItem(storageKey(corridorId), JSON.stringify(current));
}

export function resetAllOverrides(corridorId: string): void {
  if (!isStorageAvailable()) return;
  window.localStorage.removeItem(storageKey(corridorId));
}

/** True if green+yellow+red sum to the cycle length (validation for the editor form). */
export function isPlanConsistent(plan: SignalPlan): boolean {
  return Math.abs(plan.greenSec + plan.yellowSec + plan.redSec - plan.cycleSec) < 1e-6;
}

/** Returns a copy of the corridor with any locally-saved calibration overrides applied. */
export function applyOverrides(corridor: Corridor): Corridor {
  const overrides = loadOverrides(corridor.id);
  if (Object.keys(overrides).length === 0) return corridor;
  return {
    ...corridor,
    intersections: corridor.intersections.map((intersection) => {
      const override = overrides[intersection.id];
      if (!override) return intersection;
      const { confidence, ...signalPlan } = override;
      return {
        ...intersection,
        signalPlan,
        confidence,
        lastCalibratedAt: Date.now(),
      };
    }),
  };
}
