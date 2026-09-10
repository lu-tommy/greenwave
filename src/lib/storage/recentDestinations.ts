import type { DestinationCandidate } from "@/lib/types";

/** Recent destinations, local-only, no accounts. Capped so this never grows unbounded. */
const STORAGE_KEY = "greenwave:recentDestinations";
const MAX_RECENTS = 8;

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getRecentDestinations(): DestinationCandidate[] {
  if (!isStorageAvailable()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DestinationCandidate[];
  } catch {
    return [];
  }
}

export function addRecentDestination(destination: DestinationCandidate): void {
  if (!isStorageAvailable()) return;
  const current = getRecentDestinations().filter((d) => d.id !== destination.id);
  const next = [destination, ...current].slice(0, MAX_RECENTS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // best-effort convenience feature
  }
}

export function clearRecentDestinations(): void {
  if (!isStorageAvailable()) return;
  window.localStorage.removeItem(STORAGE_KEY);
}
