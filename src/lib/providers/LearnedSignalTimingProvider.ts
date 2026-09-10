import { predictSignalState } from "@/lib/signals/signalEngine";
import { decayModelConfidence } from "@/lib/learning/timingInference";
import { getSignalKnowledge } from "@/lib/storage/signalKnowledgeStore";
import type { Confidence, SignalPlan, SignalPrediction, SignalTimingProvider } from "@/lib/types";

/**
 * Serves timing inferred from real-world drive observations (see
 * src/lib/learning). Returns `plan: null` for any signal without enough
 * evidence yet — this is the common, expected case for most signals on a
 * first drive. Never fabricates a default.
 */
export class LearnedSignalTimingProvider implements SignalTimingProvider {
  async getSignalPlan(intersectionId: string): Promise<{ plan: SignalPlan | null; confidence: Confidence }> {
    const record = await getSignalKnowledge(intersectionId);
    if (!record?.timingModel) return { plan: null, confidence: 0 };

    const decayed = decayModelConfidence(record.timingModel);
    const plan: SignalPlan = {
      cycleSec: decayed.cycleSec,
      greenSec: decayed.greenSec,
      yellowSec: decayed.yellowSec,
      redSec: decayed.redSec,
      offsetSec: decayed.offsetSec,
    };
    return { plan, confidence: decayed.confidence };
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
