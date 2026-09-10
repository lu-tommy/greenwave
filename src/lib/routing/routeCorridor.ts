import type { Corridor, DiscoveredSignal, Intersection, Route, SignalTimingProvider } from "@/lib/types";

/**
 * Adapts a Route + its discovered signals into a Corridor — the same shape
 * the existing optimizer/simulator already consume. This is the seam that
 * lets one optimization engine serve both the manually-defined demo
 * corridor and real destination-based routes; nothing about the optimizer
 * changes to support routing.
 *
 * Below this confidence, a discovered signal is more likely a
 * crossing-street or opposite-carriageway signal than one that actually
 * applies to this route — it's dropped entirely rather than fed into the
 * optimizer with false authority. (It's still visible in the debug panel
 * via the raw DiscoveredSignal list, just not in the resulting Corridor.)
 */
const MIN_DIRECTION_CONFIDENCE = 0.3;

export async function buildRouteCorridor(
  route: Route,
  discoveredSignals: DiscoveredSignal[],
  timingProvider: SignalTimingProvider,
): Promise<Corridor> {
  const included = discoveredSignals.filter((s) => s.directionConfidence >= MIN_DIRECTION_CONFIDENCE);

  const intersections: Intersection[] = await Promise.all(
    included.map(async (signal) => {
      const { plan, confidence: timingConfidence } = await timingProvider.getSignalPlan(signal.id);
      // Never let a shaky "does this signal even apply to us" guess produce
      // an overconfident recommendation, even if the timing itself is well known.
      const confidence = plan == null ? 0 : Math.min(timingConfidence, signal.directionConfidence);
      return {
        id: signal.id,
        name: signal.intersectionName ?? signal.roadName ?? "Traffic signal",
        lat: signal.lat,
        lng: signal.lng,
        distanceAlongCorridorM: signal.distanceAlongRouteM,
        signalPlan: plan,
        confidence,
      } satisfies Intersection;
    }),
  );

  return {
    id: `route:${route.routeHash}`,
    name: route.destinationLabel ? `Route to ${route.destinationLabel}` : "Route",
    direction: "Route",
    // V1 uses one corridor-wide speed limit (the route's conservative
    // default). Per-step limits are captured on RouteStep already and are a
    // natural extension point, not implemented here yet.
    speedLimitMps: route.defaultSpeedLimitMps,
    polyline: route.geometry,
    intersections,
    dataSourceLabel: "OSM SIGNAL LOCATIONS · TIMING VARIES",
  };
}
