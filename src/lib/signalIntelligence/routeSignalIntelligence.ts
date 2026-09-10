import { combinedApproachConfidence, resolveApproach } from "./approachResolver";
import { confidenceTier } from "./confidence";
import type { SignalIntelligenceEngine, SignalIntelligenceResult } from "./SignalIntelligenceEngine";
import type { DiscoveredSignal, Route } from "@/lib/types";

/**
 * Clamps a fused result's confidence by how confident we are that the
 * signal even applies to this approach/movement (see approachResolver.ts).
 * Evidence sources (Manual/Learned/SPaT) know nothing about route
 * direction — this is the seam where that gets combined in, so a
 * perfectly-known timing model for the wrong direction never reports as
 * trustworthy.
 */
export function clampResultConfidence(result: SignalIntelligenceResult, ceiling: number): SignalIntelligenceResult {
  if (!result.estimate) return result;
  const confidence = Math.min(result.estimate.confidence, ceiling);
  const tier = confidenceTier(confidence);
  return {
    estimate: { ...result.estimate, confidence },
    tier,
    preciseCountdownAllowed: tier === "HIGH",
    glosaAllowed: tier !== "UNAVAILABLE",
  };
}

/**
 * Resolves an approach for every discovered signal and fuses evidence for
 * each via the given engine — the bridge between route-level signal
 * discovery and the Signal Intelligence layer. Kept separate from
 * `buildRouteCorridor` (which still only needs a plain SignalTimingProvider
 * for `Intersection.signalPlan`) so that function's existing behavior and
 * tests are untouched; callers that want richer estimates use both.
 */
export async function buildRouteSignalIntelligence(
  route: Route,
  discoveredSignals: DiscoveredSignal[],
  engine: SignalIntelligenceEngine,
  atTime: number,
): Promise<Map<string, SignalIntelligenceResult>> {
  const results = new Map<string, SignalIntelligenceResult>();
  for (const signal of discoveredSignals) {
    const resolution = resolveApproach(signal, route);
    const ceiling = combinedApproachConfidence(signal, resolution);
    const raw = await engine.evaluate(resolution.approach, atTime);
    results.set(signal.id, clampResultConfidence(raw, ceiling));
  }
  return results;
}
