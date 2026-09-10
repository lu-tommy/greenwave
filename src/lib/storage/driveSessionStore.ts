import { idbClear, idbGet, idbGetAll, idbPut, STORES } from "./db";
import type { DriveSession } from "@/lib/types";

export async function putDriveSession(session: DriveSession): Promise<void> {
  return idbPut(STORES.driveSessions, session);
}

export async function getDriveSession(id: string): Promise<DriveSession | undefined> {
  return idbGet<DriveSession>(STORES.driveSessions, id);
}

export async function getAllDriveSessions(): Promise<DriveSession[]> {
  const sessions = await idbGetAll<DriveSession>(STORES.driveSessions);
  return sessions.sort((a, b) => b.startedAt - a.startedAt);
}

export async function clearAllDriveSessions(): Promise<void> {
  return idbClear(STORES.driveSessions);
}
