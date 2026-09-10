import { mphToMps } from "@/lib/geo/units";
import type { SignalIntelligenceResult } from "./SignalIntelligenceEngine";

/**
 * Time-to-Green: the "stopped at red" product behavior. Deliberately
 * cannot express a countdown that reaches "0" or implies "go" — see
 * safety invariant #8/#9 in the README. Once the predicted transition is
 * within `watchThresholdSec`, the UI must switch to WATCH SIGNAL instead
 * of continuing to count down: the app never tells the driver it's safe
 * to enter the intersection. Only the actual signal controls that.
 */
export type TimeToGreenState =
  | { status: "COUNTDOWN"; secondsToGreen: number }
  | { status: "WATCH_SIGNAL" }
  | { status: "ESTIMATED_RANGE"; minSec: number; maxSec: number }
  | { status: "UNAVAILABLE" };

export const DEFAULT_WATCH_THRESHOLD_SEC = 5;
const STOPPED_SPEED_MPS = mphToMps(2);

export function computeTimeToGreen(
  result: SignalIntelligenceResult,
  vehicleSpeedMps: number,
  now: number,
  watchThresholdSec: number = DEFAULT_WATCH_THRESHOLD_SEC,
): TimeToGreenState {
  // Time-to-Green is a stopped-at-red behavior only — moving traffic gets GLOSA instead.
  if (vehicleSpeedMps > STOPPED_SPEED_MPS) return { status: "UNAVAILABLE" };
  if (!result.estimate || result.tier === "UNAVAILABLE") return { status: "UNAVAILABLE" };

  // Do not infer "stopped -> must be red": only act when the fused evidence
  // actually says red/yellow. Already green, or truly unknown, is not "time to green".
  if (result.estimate.phase !== "RED" && result.estimate.phase !== "YELLOW") return { status: "UNAVAILABLE" };

  const likely = result.estimate.likelyEndTime;
  if (likely == null) return { status: "UNAVAILABLE" };
  const secondsToGreen = (likely - now) / 1000;
  if (secondsToGreen <= 0) return { status: "UNAVAILABLE" }; // stale/past prediction — don't assert it

  if (result.tier === "HIGH") {
    if (secondsToGreen <= watchThresholdSec) return { status: "WATCH_SIGNAL" };
    return { status: "COUNTDOWN", secondsToGreen };
  }

  // ESTIMATED tier: a range, never false precision.
  const minSec = Math.max(0, ((result.estimate.minEndTime ?? likely) - now) / 1000);
  const maxSec = Math.max(minSec, ((result.estimate.maxEndTime ?? likely) - now) / 1000);
  if (maxSec <= watchThresholdSec) return { status: "WATCH_SIGNAL" };
  return { status: "ESTIMATED_RANGE", minSec, maxSec };
}
