import { projectOntoPolyline } from "@/lib/geo/distance";
import type { LatLng, Route, RouteProgress } from "@/lib/types";

/** Perpendicular distance from the route line beyond which we consider the driver off-route. */
export const DEFAULT_OFF_ROUTE_THRESHOLD_M = 50;

export function computeRouteProgress(
  position: LatLng,
  route: Route,
  offRouteThresholdM: number = DEFAULT_OFF_ROUTE_THRESHOLD_M,
): RouteProgress {
  const projection = projectOntoPolyline(position, route.geometry);
  return {
    distanceAlongRouteM: projection.distanceAlongM,
    offRouteM: projection.offsetM,
    offRoute: projection.offsetM > offRouteThresholdM,
    routeHeadingDeg: projection.segmentBearingDeg,
  };
}
