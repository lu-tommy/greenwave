import { classifyControlType, inferTimingModel, resynchronize } from "@/lib/learning/timingInference";
import type { ObservationEvent } from "@/lib/learning/observationTracker";
import { addObservation, getObservationsForSignal } from "@/lib/storage/driveObservationStore";
import { ensureSignalKnowledge, getSignalKnowledge, putSignalKnowledge } from "@/lib/storage/signalKnowledgeStore";
import { putDriveSession } from "@/lib/storage/driveSessionStore";
import type { Corridor, DriveObservation, DriveRecommendation, DriveSession, LatLng } from "@/lib/types";

const MAX_HISTORY_ENTRIES = 3000;
const MIN_HISTORY_SAMPLE_INTERVAL_MS = 1000;

export type DebugHistoryEntry = {
  timestamp: number;
  positionM: number;
  speedMps: number;
  instruction: string;
  targetSpeedMps: number;
  reason: string;
  confidence: number;
};

export type DriveDebugExport = {
  formatVersion: 1;
  session: DriveSession;
  history: DebugHistoryEntry[];
  observations: DriveObservation[];
  /** The final resolved corridor's signals, with whatever timing state (known/learned/unknown) was used during the drive. */
  signalsAtDriveEnd: {
    id: string;
    name: string;
    distanceAlongCorridorM: number;
    hadTimingModel: boolean;
    confidence: number;
    controlType: string | null;
    lastSynchronizedAt: number | null;
  }[];
};

export type DrivePostSummary = {
  session: DriveSession;
  timingModelsImproved: number;
  newObservations: number;
};

/**
 * Accumulates everything about one real drive: route progress, per-tick
 * recommendation snapshots (for debug export), and passive/manual signal
 * observations. On finish(), persists observations + the session, and
 * re-runs conservative timing inference for every signal touched this
 * drive — this is the actual "learning" step.
 */
export class DriveSessionRecorder {
  private session: DriveSession;
  private observations: DriveObservation[] = [];
  private history: DebugHistoryEntry[] = [];
  private lastHistoryTimestamp: number | null = null;
  private encounteredSignalIds = new Set<string>();
  private knownEncounteredSignalIds = new Set<string>();
  private corridorSnapshot: Corridor | null = null;

  constructor(origin: LatLng, destination: LatLng, destinationLabel: string, routeId: string, routeHash: string) {
    this.session = {
      id: crypto.randomUUID(),
      origin,
      destination,
      destinationLabel,
      routeId,
      routeHash,
      startedAt: Date.now(),
      endedAt: null,
      distanceM: 0,
      durationSec: 0,
      signalsEncountered: 0,
      knownSignalsEncountered: 0,
      stops: 0,
      observationIds: [],
    };
  }

  get sessionId(): string {
    return this.session.id;
  }

  recordTick(vehicle: { timestamp: number; positionM: number; speedMps: number }, recommendation: DriveRecommendation, corridor: Corridor): void {
    this.corridorSnapshot = corridor;
    for (const intersection of corridor.intersections) {
      if (vehicle.positionM >= intersection.distanceAlongCorridorM && !this.encounteredSignalIds.has(intersection.id)) {
        this.encounteredSignalIds.add(intersection.id);
        if (intersection.signalPlan != null) this.knownEncounteredSignalIds.add(intersection.id);
      }
    }

    if (this.history.length >= MAX_HISTORY_ENTRIES) return;
    if (this.lastHistoryTimestamp != null && vehicle.timestamp - this.lastHistoryTimestamp < MIN_HISTORY_SAMPLE_INTERVAL_MS) return;
    this.lastHistoryTimestamp = vehicle.timestamp;
    this.history.push({
      timestamp: vehicle.timestamp,
      positionM: vehicle.positionM,
      speedMps: vehicle.speedMps,
      instruction: recommendation.instruction,
      targetSpeedMps: recommendation.targetSpeedMps,
      reason: recommendation.reason,
      confidence: recommendation.confidence,
    });
  }

  recordObservations(events: ObservationEvent[]): void {
    for (const event of events) {
      this.observations.push({ id: crypto.randomUUID(), driveSessionId: this.session.id, ...event });
    }
  }

  /**
   * A manual TAP WHEN GREEN / TAP WHEN RED observation, recorded the same
   * way as passive ones. If the signal already has a learned model, a
   * GREEN_START_MANUAL tap immediately re-anchors its phase offset
   * (resynchronize) rather than waiting until the drive ends — this is
   * what makes tapping useful in the moment, not just for next time.
   */
  async recordManualObservation(event: ObservationEvent): Promise<void> {
    const observation = { id: crypto.randomUUID(), driveSessionId: this.session.id, ...event };
    this.observations.push(observation);

    if (event.type === "GREEN_START_MANUAL") {
      const existing = await getSignalKnowledge(event.signalId);
      if (existing?.timingModel) {
        const resynced = resynchronize(existing.timingModel, observation);
        await putSignalKnowledge({ ...existing, timingModel: resynced, lastObservedAt: Date.now() });
      }
    }
  }

  async finish(finalMetrics: { distanceM: number; durationSec: number }): Promise<DrivePostSummary> {
    this.session.endedAt = Date.now();
    this.session.distanceM = finalMetrics.distanceM;
    this.session.durationSec = finalMetrics.durationSec;
    this.session.signalsEncountered = this.encounteredSignalIds.size;
    this.session.knownSignalsEncountered = this.knownEncounteredSignalIds.size;
    this.session.stops = this.observations.filter((o) => o.type === "STOP_AT_SIGNAL").length;
    this.session.observationIds = this.observations.map((o) => o.id);

    await Promise.all(this.observations.map((o) => addObservation(o)));
    await putDriveSession(this.session);

    const timingModelsImproved = await this.updateSignalKnowledge();

    return { session: this.session, timingModelsImproved, newObservations: this.observations.length };
  }

  private async updateSignalKnowledge(): Promise<number> {
    const bySignal = new Map<string, DriveObservation[]>();
    for (const obs of this.observations) {
      const list = bySignal.get(obs.signalId) ?? [];
      list.push(obs);
      bySignal.set(obs.signalId, list);
    }

    let improved = 0;
    for (const [signalId, newObs] of bySignal) {
      const location = { lat: newObs[0].lat, lng: newObs[0].lng };
      const existing = await ensureSignalKnowledge(signalId, location, null);
      const previousConfidence = existing.timingModel?.confidence ?? 0;

      const allObservations = await getObservationsForSignal(signalId);
      const model = inferTimingModel(allObservations);
      const controlType = classifyControlType(allObservations);

      await putSignalKnowledge({
        ...existing,
        timingModel: model,
        observationCount: existing.observationCount + newObs.length,
        lastObservedAt: Date.now(),
        controlType,
      });

      if (model && model.confidence > previousConfidence) improved += 1;
    }
    return improved;
  }

  async exportDebugJson(): Promise<DriveDebugExport> {
    const signalsAtDriveEnd = this.corridorSnapshot
      ? await Promise.all(
          this.corridorSnapshot.intersections.map(async (i) => {
            const knowledge = await getSignalKnowledge(i.id);
            return {
              id: i.id,
              name: i.name,
              distanceAlongCorridorM: i.distanceAlongCorridorM,
              hadTimingModel: i.signalPlan != null,
              confidence: i.confidence,
              controlType: knowledge?.controlType ?? null,
              lastSynchronizedAt: knowledge?.timingModel?.lastSynchronizedAt ?? null,
            };
          }),
        )
      : [];

    return {
      formatVersion: 1,
      session: this.session,
      history: this.history,
      observations: this.observations,
      signalsAtDriveEnd,
    };
  }
}
