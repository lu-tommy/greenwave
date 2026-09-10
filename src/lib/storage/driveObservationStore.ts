import { idbClear, idbDelete, idbGetAllByIndex, idbPut, STORES } from "./db";
import type { DriveObservation } from "@/lib/types";

/**
 * Compact per-approach observations, not raw GPS trails. A typical signal
 * approach produces at most a handful of these (one per detected event),
 * not one per GPS sample — see src/lib/learning/observationTracker.ts.
 */
const MAX_OBSERVATIONS_PER_SIGNAL = 200;

export async function addObservation(observation: DriveObservation): Promise<void> {
  await idbPut(STORES.driveObservations, observation);
  await pruneSignal(observation.signalId);
}

export async function getObservationsForSignal(signalId: string): Promise<DriveObservation[]> {
  const results = await idbGetAllByIndex<DriveObservation>(STORES.driveObservations, "signalId", signalId);
  return results.sort((a, b) => a.timestamp - b.timestamp);
}

export async function getObservationsForSession(driveSessionId: string): Promise<DriveObservation[]> {
  const results = await idbGetAllByIndex<DriveObservation>(STORES.driveObservations, "driveSessionId", driveSessionId);
  return results.sort((a, b) => a.timestamp - b.timestamp);
}

export async function clearAllObservations(): Promise<void> {
  return idbClear(STORES.driveObservations);
}

/** Caps stored observations per signal so a single frequently-driven route doesn't grow the store unbounded — oldest are dropped first. */
async function pruneSignal(signalId: string): Promise<void> {
  const all = await getObservationsForSignal(signalId);
  if (all.length <= MAX_OBSERVATIONS_PER_SIGNAL) return;
  const toDrop = all.slice(0, all.length - MAX_OBSERVATIONS_PER_SIGNAL);
  await Promise.all(toDrop.map((o) => idbDelete(STORES.driveObservations, o.id)));
}
