import { mphToMps } from "@/lib/geo/units";
import type { LatLng, ObservationType } from "@/lib/types";

/**
 * Passive, conservative approach/departure detection for real drives. Does
 * NOT assert exact phase timing from a single event — it only emits
 * compact observation events; src/lib/learning/timingInference.ts decides
 * later, across many observations, whether there's enough evidence for a
 * timing model.
 */

const STOP_SPEED_MPS = mphToMps(2);
const DEPART_SPEED_MPS = mphToMps(3);
const APPROACH_WINDOW_M = 30;
const MIN_STOP_DURATION_MS = 1000;

export type TrackerSample = {
  timestamp: number;
  positionM: number;
  speedMps: number;
  position: LatLng;
  routeHeadingDeg: number;
};

export type SignalRef = { id: string; distanceAlongCorridorM: number };

export type ObservationEvent = {
  signalId: string;
  type: ObservationType;
  timestamp: number;
  lat: number;
  lng: number;
  speedMps: number;
  distanceToSignalM: number;
  routeHeadingDeg: number;
  confidence: number;
};

const CONFIDENCE_BY_TYPE: Record<Extract<ObservationType, "STOP_AT_SIGNAL" | "DEPART_SIGNAL" | "PASS_SIGNAL_WITHOUT_STOP">, number> = {
  STOP_AT_SIGNAL: 0.3,
  DEPART_SIGNAL: 0.35,
  PASS_SIGNAL_WITHOUT_STOP: 0.5,
};

type PerSignalState = {
  stopStartedAtSample: TrackerSample | null;
  /** True once a terminal event (a resolved stop->depart pair, or a clean pass) has been emitted for this approach. */
  resolved: boolean;
};

export class ObservationTracker {
  private state = new Map<string, PerSignalState>();

  /** Call once per GPS/simulation tick with the current sample and the signals currently in the optimizer's upcoming window. */
  processTick(sample: TrackerSample, upcomingSignals: SignalRef[]): ObservationEvent[] {
    const events: ObservationEvent[] = [];

    for (const signal of upcomingSignals) {
      const distanceToSignalM = signal.distanceAlongCorridorM - sample.positionM;
      if (distanceToSignalM > APPROACH_WINDOW_M || distanceToSignalM < -APPROACH_WINDOW_M) continue;

      let st = this.state.get(signal.id);
      if (!st) {
        st = { stopStartedAtSample: null, resolved: false };
        this.state.set(signal.id, st);
      }
      if (st.resolved) continue;

      if (sample.speedMps <= STOP_SPEED_MPS) {
        if (st.stopStartedAtSample == null) st.stopStartedAtSample = sample;
        continue;
      }

      if (st.stopStartedAtSample != null) {
        const stopDurationMs = sample.timestamp - st.stopStartedAtSample.timestamp;
        if (stopDurationMs >= MIN_STOP_DURATION_MS && sample.speedMps >= DEPART_SPEED_MPS) {
          const stopSample = st.stopStartedAtSample;
          events.push(makeEvent(signal, "STOP_AT_SIGNAL", stopSample, signal.distanceAlongCorridorM - stopSample.positionM));
          events.push(makeEvent(signal, "DEPART_SIGNAL", sample, distanceToSignalM));
          st.resolved = true;
        }
        st.stopStartedAtSample = null;
        continue;
      }

      // Never slowed near the stop threshold, and now past the signal: a clean pass.
      if (distanceToSignalM < -5) {
        events.push(makeEvent(signal, "PASS_SIGNAL_WITHOUT_STOP", sample, distanceToSignalM));
        st.resolved = true;
      }
    }

    return events;
  }

  /** Resets tracking state — call when a route/corridor changes (new drive, reroute). */
  reset(): void {
    this.state.clear();
  }
}

function makeEvent(
  signal: SignalRef,
  type: Extract<ObservationType, "STOP_AT_SIGNAL" | "DEPART_SIGNAL" | "PASS_SIGNAL_WITHOUT_STOP">,
  sample: TrackerSample,
  distanceToSignalM: number,
): ObservationEvent {
  return {
    signalId: signal.id,
    type,
    timestamp: sample.timestamp,
    lat: sample.position.lat,
    lng: sample.position.lng,
    speedMps: sample.speedMps,
    distanceToSignalM,
    routeHeadingDeg: sample.routeHeadingDeg,
    confidence: CONFIDENCE_BY_TYPE[type],
  };
}

/** Builds a manual-tap observation event (TAP WHEN GREEN / TAP WHEN RED) — always high confidence, a deliberate user action. */
export function makeManualObservation(
  signalId: string,
  type: Extract<ObservationType, "GREEN_START_MANUAL" | "RED_START_MANUAL">,
  sample: TrackerSample,
  distanceToSignalM: number,
): ObservationEvent {
  return {
    signalId,
    type,
    timestamp: sample.timestamp,
    lat: sample.position.lat,
    lng: sample.position.lng,
    speedMps: sample.speedMps,
    distanceToSignalM,
    routeHeadingDeg: sample.routeHeadingDeg,
    confidence: 0.95,
  };
}
