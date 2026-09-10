import { predictSignalState } from "@/lib/signals/signalEngine";
import { getManualOverride, REAL_WORLD_CALIBRATION_NAMESPACE } from "@/lib/storage/calibrationStorage";
import type { Confidence, SignalPlan, SignalPrediction, SignalTimingProvider } from "@/lib/types";

/**
 * Serves signal timing the user has manually calibrated for a real-world
 * (route-discovered) signal via the Calibration page. Reuses the same
 * localStorage-backed override mechanism as the demo corridor, under a
 * shared namespace so a manual calibration survives across different
 * routes that happen to pass the same physical signal.
 */
export class ManualSignalTimingProvider implements SignalTimingProvider {
  async getSignalPlan(intersectionId: string): Promise<{ plan: SignalPlan | null; confidence: Confidence }> {
    const override = getManualOverride(REAL_WORLD_CALIBRATION_NAMESPACE, intersectionId);
    if (!override) return { plan: null, confidence: 0 };
    const { confidence, ...plan } = override;
    return { plan, confidence };
  }

  async getSignalPrediction(intersectionId: string, timestamp: number): Promise<SignalPrediction> {
    const { plan, confidence } = await this.getSignalPlan(intersectionId);
    if (!plan) {
      return {
        intersectionId,
        phase: "unknown",
        secondsRemainingInPhase: null,
        nextTransitionAt: null,
        nextGreenAt: null,
        nextGreenEndsAt: null,
        confidence: 0,
      };
    }
    return predictSignalState(
      { id: intersectionId, name: "", lat: 0, lng: 0, distanceAlongCorridorM: 0, signalPlan: plan, confidence },
      timestamp,
    );
  }
}
