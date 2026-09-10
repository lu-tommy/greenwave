import type { SignalApproach, SignalIntelligenceProvider, SignalTimingEvidence, SpatEvent, SpatIntersectionState } from "@/lib/types";

/**
 * A clean ingestion contract for normalized SPaT-shaped messages, usable
 * today for tests and a replay/demo mode, and ready for a real live feed
 * later without changing its shape. Deliberately NOT an HTTP endpoint:
 * per the project's safety rules, there is no unauthenticated public write
 * path in this app. Real ingestion (a live feed, a WebSocket, a polling
 * job) would call `SpatMessageStore.ingest()` server-side; for now, tests
 * and the replay driver below call it directly.
 */

const VALID_STATES = new Set(["GREEN", "YELLOW", "RED", "UNKNOWN"]);

function isValidEvent(value: unknown): value is SpatEvent {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return VALID_STATES.has(e.state as string) && typeof e.minEndTime === "number";
}

/** Validates a raw payload against the normalized SPaT shape. Throws with a specific message on the first problem found, rather than silently coercing bad data. */
export function parseSpatMessage(raw: unknown): SpatIntersectionState {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("SPaT message must be an object");
  }
  const msg = raw as Record<string, unknown>;

  if (typeof msg.intersectionId !== "string" || msg.intersectionId.length === 0) {
    throw new Error("SPaT message missing intersectionId");
  }
  if (typeof msg.timestamp !== "number" || !Number.isFinite(msg.timestamp)) {
    throw new Error("SPaT message missing a numeric timestamp");
  }
  if (!Array.isArray(msg.signalGroups)) {
    throw new Error("SPaT message missing signalGroups array");
  }

  const signalGroups = msg.signalGroups.map((group, idx) => {
    if (typeof group !== "object" || group === null) {
      throw new Error(`signalGroups[${idx}] must be an object`);
    }
    const g = group as Record<string, unknown>;
    if (typeof g.signalGroupId !== "string") {
      throw new Error(`signalGroups[${idx}] missing signalGroupId`);
    }
    if (!Array.isArray(g.events) || !g.events.every(isValidEvent)) {
      throw new Error(`signalGroups[${idx}] has invalid or missing events`);
    }
    return {
      signalGroupId: g.signalGroupId,
      movement: typeof g.movement === "string" ? (g.movement as SpatIntersectionState["signalGroups"][number]["movement"]) : "UNKNOWN",
      events: g.events as SpatEvent[],
    };
  });

  return { intersectionId: msg.intersectionId, timestamp: msg.timestamp, signalGroups };
}

/** Holds the latest SPaT message per intersection. In-memory only — this is not a persistence layer. */
export class SpatMessageStore {
  private messages = new Map<string, SpatIntersectionState>();

  ingest(message: SpatIntersectionState): void {
    this.messages.set(message.intersectionId, message);
  }

  getLatest(intersectionId: string): SpatIntersectionState | null {
    return this.messages.get(intersectionId) ?? null;
  }

  clear(): void {
    this.messages.clear();
  }
}

/**
 * Derives a next-green window from an ordered event list. `events[0]` is
 * the current phase; later entries are the intersection's next known
 * upcoming phases (as real SPaT messages typically provide 1-2 ahead).
 */
function deriveGreenWindow(events: SpatEvent[], observedAt: number): { nextGreenStart: number | null; nextGreenEnd: number | null } {
  if (events.length === 0) return { nextGreenStart: null, nextGreenEnd: null };
  const current = events[0];
  if (current.state === "GREEN") {
    return { nextGreenStart: observedAt, nextGreenEnd: current.likelyEndTime ?? current.minEndTime };
  }
  const greenIdx = events.findIndex((e) => e.state === "GREEN");
  if (greenIdx <= 0) return { nextGreenStart: null, nextGreenEnd: null };
  const priorEvent = events[greenIdx - 1];
  const greenEvent = events[greenIdx];
  return {
    nextGreenStart: priorEvent.likelyEndTime ?? priorEvent.minEndTime,
    nextGreenEnd: greenEvent.likelyEndTime ?? greenEvent.minEndTime,
  };
}

/**
 * The real (not stubbed) SPaT provider — reads whatever has been ingested
 * into a SpatMessageStore. Source is always "OFFICIAL_LIVE": this
 * represents what a genuine SPaT feed would look like; freshness gating in
 * the fusion engine is what actually protects against stale data, exactly
 * as it would for a real feed.
 */
export class SpatSignalTimingProvider implements SignalIntelligenceProvider {
  constructor(private readonly store: SpatMessageStore) {}

  async getTiming(approach: SignalApproach, _atTime: number): Promise<SignalTimingEvidence | null> {
    const message = this.store.getLatest(approach.signalId);
    if (!message) return null;

    // Safety invariant: a turn movement (LEFT/RIGHT/U_TURN) must match its
    // own signal group exactly. Falling back to a THROUGH group's timing
    // for a turn would silently substitute the wrong phase — e.g. a
    // protected left-turn arrow can be timed completely differently from
    // through traffic. Only THROUGH/UNKNOWN movements get a generic fallback.
    const isTurn = approach.maneuver === "LEFT" || approach.maneuver === "RIGHT" || approach.maneuver === "U_TURN";
    const group = isTurn
      ? message.signalGroups.find((g) => g.movement === approach.maneuver)
      : message.signalGroups.find((g) => g.movement === approach.maneuver) ??
        message.signalGroups.find((g) => g.movement === "THROUGH") ??
        message.signalGroups[0];
    if (!group || group.events.length === 0) return null;

    const current = group.events[0];
    const { nextGreenStart, nextGreenEnd } = deriveGreenWindow(group.events, message.timestamp);

    return {
      source: "OFFICIAL_LIVE",
      phase: current.state,
      minEndTime: current.minEndTime,
      likelyEndTime: current.likelyEndTime ?? current.minEndTime,
      maxEndTime: current.maxEndTime ?? current.minEndTime,
      nextGreenStart,
      nextGreenEnd,
      confidence: 0.98,
      observedAt: message.timestamp,
      metadata: { intersectionId: message.intersectionId, signalGroupId: group.signalGroupId },
    };
  }
}
