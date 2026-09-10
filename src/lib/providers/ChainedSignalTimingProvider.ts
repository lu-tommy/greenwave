import type { Confidence, SignalPlan, SignalPrediction, SignalTimingProvider } from "@/lib/types";

/**
 * Tries each provider in order and returns the first one that actually
 * knows the signal's timing. Conceptually:
 *   1. manually calibrated (ManualSignalTimingProvider)
 *   2. learned from observations (LearnedSignalTimingProvider)
 *   3. static/demo (StaticSignalTimingProvider)
 *   4. unknown (no provider had it — never fabricated)
 *
 * The optimizer and UI only ever talk to this interface — they don't know
 * or care which underlying source actually answered.
 */
export class ChainedSignalTimingProvider implements SignalTimingProvider {
  constructor(private readonly providers: SignalTimingProvider[]) {}

  async getSignalPlan(intersectionId: string): Promise<{ plan: SignalPlan | null; confidence: Confidence }> {
    for (const provider of this.providers) {
      const result = await provider.getSignalPlan(intersectionId);
      if (result.plan != null) return result;
    }
    return { plan: null, confidence: 0 };
  }

  async getSignalPrediction(intersectionId: string, timestamp: number): Promise<SignalPrediction> {
    for (const provider of this.providers) {
      const { plan } = await provider.getSignalPlan(intersectionId);
      if (plan != null) return provider.getSignalPrediction(intersectionId, timestamp);
    }
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
}
