import { predictSignalState } from "@/lib/signals/signalEngine";
import type { Corridor, Confidence, SignalPlan, SignalPrediction, SignalTimingProvider } from "@/lib/types";

/**
 * Serves signal predictions from a fixed, manually-calibrated Corridor
 * definition (demo data, or a route corridor with manual calibration
 * overrides applied). It exists behind the SignalTimingProvider interface
 * so that LearnedSignalTimingProvider (inferred from real-world
 * observations), CrowdsourcedSignalTimingProvider, or a real
 * SpatSignalTimingProvider (official SPaT/MAP feeds) can be swapped in or
 * chained without changing the optimizer or UI, which only ever depend on
 * this interface.
 */
export class StaticSignalTimingProvider implements SignalTimingProvider {
  constructor(private readonly corridor: Corridor) {}

  private findIntersection(intersectionId: string) {
    return this.corridor.intersections.find((i) => i.id === intersectionId);
  }

  async getSignalPrediction(intersectionId: string, timestamp: number): Promise<SignalPrediction> {
    const intersection = this.findIntersection(intersectionId);
    if (!intersection) {
      throw new Error(`Unknown intersection: ${intersectionId}`);
    }
    return predictSignalState(intersection, timestamp);
  }

  async getSignalPlan(intersectionId: string): Promise<{ plan: SignalPlan | null; confidence: Confidence }> {
    const intersection = this.findIntersection(intersectionId);
    if (!intersection) return { plan: null, confidence: 0 };
    return { plan: intersection.signalPlan, confidence: intersection.confidence };
  }
}
