import type {
  SignalApproach,
  SignalIntelligenceProvider,
  SignalPrediction,
  SignalSource,
  SignalTimingEvidence,
  SignalTimingProvider,
} from "@/lib/types";

/**
 * Wraps an existing `SignalTimingProvider` (Manual/Learned/Static — none of
 * which changed) so it can participate in the new Signal Intelligence
 * fusion engine as a `SignalIntelligenceProvider`. This is composition, not
 * a rewrite: the legacy providers keep working exactly as they did for
 * anything that still calls them directly.
 *
 * `source` is supplied by the caller rather than inferred, so a provider
 * wrapping *simulated* data is never mislabeled as authoritative — e.g.
 * the demo corridor's StaticSignalTimingProvider should be wrapped with
 * "HISTORICAL", never "OFFICIAL_STATIC", unless it's genuinely serving a
 * published authoritative plan.
 */
export class LegacyTimingProviderAdapter implements SignalIntelligenceProvider {
  constructor(
    private readonly inner: SignalTimingProvider,
    private readonly source: SignalSource,
  ) {}

  async getTiming(approach: SignalApproach, atTime: number): Promise<SignalTimingEvidence | null> {
    // Legacy providers throw for a signal id they've genuinely never heard
    // of (see StaticSignalTimingProvider) rather than returning an "unknown"
    // prediction — expected when asking a provider chain member that simply
    // doesn't cover this signal, so it's treated as "no evidence", not an error.
    let prediction;
    try {
      prediction = await this.inner.getSignalPrediction(approach.signalId, atTime);
    } catch {
      return null;
    }
    return predictionToEvidence(prediction, this.source, atTime);
  }
}

/**
 * Converts the legacy deterministic `SignalPrediction` (phase + exact next
 * transition, derived from a `SignalPlan`) into the normalized evidence
 * shape. A deterministic plan has no window uncertainty of its own — min,
 * likely, and max collapse to the same instant — so all of the model's
 * uncertainty is carried in `confidence`, not the window bounds.
 *
 * minEndTime/likelyEndTime/maxEndTime describe time-to-GREEN specifically,
 * so they must be `nextGreenAt` — NOT `nextTransitionAt` (end of the
 * *current* phase). Those two coincide while RED (its only transition is to
 * green), but diverge during YELLOW, whose next transition is to RED, one
 * full red-phase short of green.
 */
export function predictionToEvidence(prediction: SignalPrediction, source: SignalSource, observedAt: number): SignalTimingEvidence | null {
  if (prediction.phase === "unknown") return null;

  const phase = prediction.phase.toUpperCase() as "GREEN" | "YELLOW" | "RED";
  return {
    source,
    phase,
    minEndTime: prediction.nextGreenAt,
    likelyEndTime: prediction.nextGreenAt,
    maxEndTime: prediction.nextGreenAt,
    nextGreenStart: prediction.nextGreenAt,
    nextGreenEnd: prediction.nextGreenEndsAt,
    confidence: prediction.confidence,
    observedAt,
  };
}
