import { haversineDistance } from "./distance";
import type { LatLng } from "@/lib/types";

/**
 * Smooths noisy GPS speed readings so a single bad sample can't cause a
 * large, sudden recommendation change.
 *
 * Strategy (documented per the spec's request):
 *   1. Prefer the browser-reported `coords.speed` when available and
 *      plausible; otherwise derive speed from consecutive position fixes
 *      (distance / elapsed time).
 *   2. Reject implausible single-sample jumps: if a new raw reading
 *      implies exceeding a generous acceleration cap (~4 m/s^2, well
 *      above normal driving) relative to the last *accepted* raw reading,
 *      it's treated as noise and discarded — UNLESS a second consecutive
 *      reading agrees with it, in which case it's treated as a real,
 *      sustained speed change (e.g. genuine hard braking) and accepted so
 *      the filter can't get permanently stuck rejecting real data.
 *   3. Accepted raw readings feed a rolling median (last 5 — kills
 *      single-sample spikes cheaply), which in turn feeds an exponential
 *      moving average (alpha = 0.35) for temporal smoothness.
 */

const WINDOW_SIZE = 5;
const MAX_PLAUSIBLE_ACCEL_MPS2 = 4;
const OUTLIER_AGREEMENT_TOLERANCE_MPS = 1.5;
const EMA_ALPHA = 0.35;

export type GpsSample = {
  timestamp: number;
  position: LatLng;
  reportedSpeedMps?: number | null;
};

export type SpeedFilterState = {
  lastSample: GpsSample | null;
  lastAcceptedRawSpeed: number | null;
  lastAcceptedTimestamp: number | null;
  rawWindow: number[];
  emaSpeedMps: number | null;
  pendingOutlier: { speed: number; count: number } | null;
};

export const initialSpeedFilterState: SpeedFilterState = {
  lastSample: null,
  lastAcceptedRawSpeed: null,
  lastAcceptedTimestamp: null,
  rawWindow: [],
  emaSpeedMps: null,
  pendingOutlier: null,
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function deriveRawSpeed(state: SpeedFilterState, sample: GpsSample): number | null {
  if (sample.reportedSpeedMps != null && Number.isFinite(sample.reportedSpeedMps) && sample.reportedSpeedMps >= 0) {
    return sample.reportedSpeedMps;
  }
  if (!state.lastSample) return null;
  const dtSec = (sample.timestamp - state.lastSample.timestamp) / 1000;
  if (dtSec <= 0.05) return null;
  return haversineDistance(state.lastSample.position, sample.position) / dtSec;
}

function accept(state: SpeedFilterState, sample: GpsSample, rawSpeed: number): SpeedFilterState {
  const rawWindow = [...state.rawWindow, rawSpeed].slice(-WINDOW_SIZE);
  const medianSpeed = median(rawWindow);
  const emaSpeedMps =
    state.emaSpeedMps == null ? medianSpeed : EMA_ALPHA * medianSpeed + (1 - EMA_ALPHA) * state.emaSpeedMps;
  return {
    lastSample: sample,
    lastAcceptedRawSpeed: rawSpeed,
    lastAcceptedTimestamp: sample.timestamp,
    rawWindow,
    emaSpeedMps,
    pendingOutlier: null,
  };
}

export function updateSpeedFilter(
  state: SpeedFilterState,
  sample: GpsSample,
): { state: SpeedFilterState; speedMps: number | null } {
  const rawSpeed = deriveRawSpeed(state, sample);

  if (rawSpeed == null) {
    return { state: { ...state, lastSample: sample }, speedMps: state.emaSpeedMps };
  }

  if (state.lastAcceptedRawSpeed == null || state.lastAcceptedTimestamp == null) {
    const next = accept(state, sample, rawSpeed);
    return { state: next, speedMps: next.emaSpeedMps };
  }

  const dtSec = Math.max((sample.timestamp - state.lastAcceptedTimestamp) / 1000, 0.05);
  const impliedAccel = Math.abs(rawSpeed - state.lastAcceptedRawSpeed) / dtSec;

  if (impliedAccel <= MAX_PLAUSIBLE_ACCEL_MPS2) {
    const next = accept(state, sample, rawSpeed);
    return { state: next, speedMps: next.emaSpeedMps };
  }

  const agreesWithPending =
    state.pendingOutlier != null && Math.abs(state.pendingOutlier.speed - rawSpeed) <= OUTLIER_AGREEMENT_TOLERANCE_MPS;

  if (agreesWithPending) {
    // Two consecutive readings agree on a "jump" — treat as a real, sustained change.
    const next = accept(state, sample, rawSpeed);
    return { state: next, speedMps: next.emaSpeedMps };
  }

  return {
    state: { ...state, lastSample: sample, pendingOutlier: { speed: rawSpeed, count: 1 } },
    speedMps: state.emaSpeedMps,
  };
}
