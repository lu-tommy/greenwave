import { predictSignalState } from "@/lib/signals/signalEngine";
import type { Corridor, SignalPrediction, SignalTimingProvider } from "@/lib/types";

/**
 * Serves signal predictions from a fixed, manually-calibrated Corridor
 * definition (see src/lib/data/corridors). This is the only provider V1
 * ships. It exists behind the SignalTimingProvider interface so that
 * later providers — LearnedSignalTimingProvider (inferred from crowdsourced
 * observations), CrowdsourcedSignalTimingProvider, or a real
 * SpatSignalTimingProvider (official SPaT/MAP feeds) — can be swapped in
 * without changing the optimizer or UI, which only ever depend on this
 * interface.
 */
export class StaticSignalTimingProvider implements SignalTimingProvider {
  constructor(private readonly corridor: Corridor) {}

  async getSignalPrediction(intersectionId: string, timestamp: number): Promise<SignalPrediction> {
    const intersection = this.corridor.intersections.find((i) => i.id === intersectionId);
    if (!intersection) {
      throw new Error(`Unknown intersection: ${intersectionId}`);
    }
    return predictSignalState(intersection, timestamp);
  }
}
