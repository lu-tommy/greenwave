import { idbClear, idbDelete, idbGet, idbGetAll, idbPut, STORES } from "./db";
import type { SignalKnowledgeRecord } from "@/lib/types";

export async function getSignalKnowledge(signalId: string): Promise<SignalKnowledgeRecord | undefined> {
  return idbGet<SignalKnowledgeRecord>(STORES.signalKnowledge, signalId);
}

export async function getAllSignalKnowledge(): Promise<SignalKnowledgeRecord[]> {
  return idbGetAll<SignalKnowledgeRecord>(STORES.signalKnowledge);
}

export async function putSignalKnowledge(record: SignalKnowledgeRecord): Promise<void> {
  return idbPut(STORES.signalKnowledge, record);
}

export async function deleteSignalKnowledge(signalId: string): Promise<void> {
  return idbDelete(STORES.signalKnowledge, signalId);
}

export async function clearAllSignalKnowledge(): Promise<void> {
  return idbClear(STORES.signalKnowledge);
}

/** Creates a fresh record or returns the existing one for this signal — never overwrites an existing model. */
export async function ensureSignalKnowledge(
  signalId: string,
  location: { lat: number; lng: number },
  direction: number | null,
): Promise<SignalKnowledgeRecord> {
  const existing = await getSignalKnowledge(signalId);
  if (existing) return existing;
  const now = Date.now();
  const record: SignalKnowledgeRecord = {
    signalId,
    lat: location.lat,
    lng: location.lng,
    direction,
    timingModel: null,
    observationCount: 0,
    firstObservedAt: now,
    lastObservedAt: now,
  };
  await putSignalKnowledge(record);
  return record;
}
