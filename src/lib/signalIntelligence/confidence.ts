import type { ConfidenceTier, SignalSource } from "@/lib/types";

/**
 * Centralized confidence tiers and per-source freshness policy — the
 * single source of truth so these numbers are never scattered through UI
 * components. See README's Signal Intelligence section for the product
 * rationale.
 */

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.95,
  ESTIMATED: 0.8,
} as const;

export function confidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) return "HIGH";
  if (confidence >= CONFIDENCE_THRESHOLDS.ESTIMATED) return "ESTIMATED";
  return "UNAVAILABLE";
}

const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;

/**
 * `decayStartMs`: age at which a soft linear decay toward 0 confidence
 * begins. `hardExpiryMs`: age beyond which the evidence is discarded
 * outright (effective confidence 0) — this is what makes "stale live data
 * can never remain authoritative" a structural guarantee rather than a UI
 * suggestion. Live sources decay fast and hard; static/manual timing barely
 * decays at all on its own (LEARNED already carries its own decay from
 * `decayModelConfidence` — this is a light additional safety net, not the
 * primary mechanism for that source).
 */
type FreshnessPolicy = { decayStartMs: number; hardExpiryMs: number };

const FRESHNESS_POLICY: Record<SignalSource, FreshnessPolicy> = {
  OFFICIAL_LIVE: { decayStartMs: 3 * SECOND, hardExpiryMs: 8 * SECOND },
  EXTERNAL_LIVE: { decayStartMs: 5 * SECOND, hardExpiryMs: 12 * SECOND },
  OFFICIAL_STATIC: { decayStartMs: 365 * DAY, hardExpiryMs: 5 * 365 * DAY },
  LEARNED: { decayStartMs: 30 * DAY, hardExpiryMs: 90 * DAY },
  MANUAL: { decayStartMs: 365 * DAY, hardExpiryMs: 5 * 365 * DAY },
  HISTORICAL: { decayStartMs: 0, hardExpiryMs: 365 * DAY },
  UNKNOWN: { decayStartMs: 0, hardExpiryMs: 0 },
};

type Aged = { source: SignalSource; observedAt: number };

export function isEvidenceFresh(evidence: Aged, atTime: number): boolean {
  const ageMs = atTime - evidence.observedAt;
  if (ageMs < 0) return true; // clock-skew guard: don't penalize evidence that looks slightly "from the future"
  return ageMs < FRESHNESS_POLICY[evidence.source].hardExpiryMs;
}

/**
 * Confidence discounted for age. Never exceeds the evidence's own
 * confidence — only reduces it. Reaches exactly 0 at/after hard expiry.
 */
export function effectiveConfidence(evidence: Aged & { confidence: number }, atTime: number): number {
  const ageMs = Math.max(0, atTime - evidence.observedAt);
  const policy = FRESHNESS_POLICY[evidence.source];
  if (ageMs >= policy.hardExpiryMs) return 0;
  if (ageMs <= policy.decayStartMs) return evidence.confidence;
  const decayRange = policy.hardExpiryMs - policy.decayStartMs;
  const decayProgress = (ageMs - policy.decayStartMs) / decayRange;
  return evidence.confidence * (1 - decayProgress);
}
