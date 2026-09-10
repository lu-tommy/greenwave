import { confidenceTier, effectiveConfidence } from "./confidence";
import type { ConfidenceTier, SignalApproach, SignalIntelligenceProvider, SignalSource, SignalTimingEstimate } from "@/lib/types";

/**
 * Fuses evidence from every configured provider into one best estimate.
 *
 * Precedence is intentionally NOT a fixed provider ranking. Effective
 * confidence (raw confidence discounted for freshness — see
 * src/lib/signalIntelligence/confidence.ts) is the primary ranking key:
 * this is what lets "fresh live" beat "stale live" (excluded entirely once
 * expired) and lets a deliberately-authoritative manual calibration (a
 * human who directly confirmed the timing) beat a so-so learned model,
 * without hardcoding "manual < learned" or vice versa. Source is only a
 * tie-breaker when two pieces of evidence are close enough in effective
 * confidence (within TIE_BREAK_MARGIN) that the difference isn't
 * meaningful — at that point we prefer the generally more authoritative
 * source type as a sensible default.
 */

const TIE_BREAK_MARGIN = 0.05;

const SOURCE_RANK: Record<SignalSource, number> = {
  OFFICIAL_LIVE: 6,
  EXTERNAL_LIVE: 5,
  OFFICIAL_STATIC: 4,
  LEARNED: 3,
  MANUAL: 2,
  HISTORICAL: 1,
  UNKNOWN: 0,
};

export type SignalIntelligenceResult = {
  estimate: SignalTimingEstimate | null;
  tier: ConfidenceTier;
  /** Only a HIGH-confidence estimate may drive a precise Time-to-Green countdown. */
  preciseCountdownAllowed: boolean;
  /** HIGH or ESTIMATED may inform GLOSA (with appropriately wider uncertainty at ESTIMATED); UNAVAILABLE may not. */
  glosaAllowed: boolean;
};

const UNAVAILABLE_RESULT: SignalIntelligenceResult = {
  estimate: null,
  tier: "UNAVAILABLE",
  preciseCountdownAllowed: false,
  glosaAllowed: false,
};

export class SignalIntelligenceEngine {
  constructor(private readonly providers: SignalIntelligenceProvider[]) {}

  async evaluate(approach: SignalApproach, atTime: number): Promise<SignalIntelligenceResult> {
    const evidenceList = await Promise.all(this.providers.map((p) => p.getTiming(approach, atTime)));

    const scored = evidenceList
      .filter((e): e is NonNullable<typeof e> => e != null && e.phase != null)
      .map((evidence) => ({ evidence, effConf: effectiveConfidence(evidence, atTime) }))
      .filter((s) => s.effConf > 0); // fully expired (e.g. stale live) evidence never competes

    if (scored.length === 0) return UNAVAILABLE_RESULT;

    scored.sort((a, b) => {
      if (Math.abs(a.effConf - b.effConf) > TIE_BREAK_MARGIN) return b.effConf - a.effConf;
      return SOURCE_RANK[b.evidence.source] - SOURCE_RANK[a.evidence.source];
    });

    const best = scored[0];
    const estimate: SignalTimingEstimate = {
      ...best.evidence,
      confidence: best.effConf,
      freshnessMs: Math.max(0, atTime - best.evidence.observedAt),
    };

    const tier = confidenceTier(estimate.confidence);
    return {
      estimate,
      tier,
      preciseCountdownAllowed: tier === "HIGH",
      glosaAllowed: tier !== "UNAVAILABLE",
    };
  }
}
