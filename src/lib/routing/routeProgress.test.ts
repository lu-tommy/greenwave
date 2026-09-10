import { describe, expect, it } from "vitest";
import { computeRouteProgress } from "./routeProgress";
import { buildMockRoute } from "./mockProviders";

describe("computeRouteProgress", () => {
  it("reports offRoute: false while close to the route line", () => {
    const route = buildMockRoute();
    const onRoute = route.geometry[5];
    const progress = computeRouteProgress(onRoute, route);
    expect(progress.offRoute).toBe(false);
    expect(progress.offRouteM).toBeLessThan(5);
  });

  it("reports offRoute: true once far enough from the route line", () => {
    const route = buildMockRoute();
    const nearby = route.geometry[5];
    const farAway = { lat: nearby.lat + 0.01, lng: nearby.lng }; // roughly 1.1km north
    const progress = computeRouteProgress(farAway, route);
    expect(progress.offRoute).toBe(true);
    expect(progress.offRouteM).toBeGreaterThan(DEFAULT_THRESHOLD);
  });

  it("distanceAlongRouteM increases monotonically for points further along the route", () => {
    const route = buildMockRoute();
    const early = computeRouteProgress(route.geometry[2], route);
    const later = computeRouteProgress(route.geometry[10], route);
    expect(later.distanceAlongRouteM).toBeGreaterThan(early.distanceAlongRouteM);
  });

  it("respects a custom off-route threshold", () => {
    const route = buildMockRoute();
    const nearby = route.geometry[5];
    const slightlyOff = { lat: nearby.lat + 0.0003, lng: nearby.lng }; // ~33m
    const strict = computeRouteProgress(slightlyOff, route, 10);
    const lenient = computeRouteProgress(slightlyOff, route, 100);
    expect(strict.offRoute).toBe(true);
    expect(lenient.offRoute).toBe(false);
  });
});

const DEFAULT_THRESHOLD = 50;
