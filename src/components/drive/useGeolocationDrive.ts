"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { initialSpeedFilterState, updateSpeedFilter } from "@/lib/geo/speedFilter";
import { projectOntoPolyline } from "@/lib/geo/distance";
import { DEFAULT_CONSTRAINTS, optimize } from "@/lib/optimizer/optimizer";
import type { Corridor, DriveRecommendation, LatLng } from "@/lib/types";

export type DriveStatus = "idle" | "requesting" | "active" | "denied" | "unsupported" | "error";

/** How far off the corridor (meters) a fix can be before we call the corridor match unreliable. */
const MAX_OFFSET_M = 40;
/** Corridors have a heading; if the driver's bearing deviates from it by more than this, we don't trust progress. */
const MAX_BEARING_DEVIATION_DEG = 60;

export type DriveMatchState = {
  status: DriveStatus;
  position: LatLng | null;
  timestamp: number | null;
  speedMps: number;
  headingDeg: number | null;
  distanceAlongM: number | null;
  offCorridorM: number | null;
  aligned: boolean;
  recommendation: DriveRecommendation | null;
  errorMessage: string | null;
};

export function useGeolocationDrive(corridor: Corridor | null): DriveMatchState & { requestLocation: () => void } {
  const [state, setState] = useState<DriveMatchState>({
    status: "idle",
    position: null,
    timestamp: null,
    speedMps: 0,
    headingDeg: null,
    distanceAlongM: null,
    offCorridorM: null,
    aligned: false,
    recommendation: null,
    errorMessage: null,
  });

  const filterStateRef = useRef(initialSpeedFilterState);
  const lastRecommendationRef = useRef<DriveRecommendation | null>(null);
  const lastPositionRef = useRef<LatLng | null>(null);

  const handlePosition = useCallback(
    (pos: GeolocationPosition) => {
      if (!corridor) return;
      const position: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };

      const { state: nextFilterState, speedMps } = updateSpeedFilter(filterStateRef.current, {
        timestamp: pos.timestamp,
        position,
        reportedSpeedMps: pos.coords.speed,
      });
      filterStateRef.current = nextFilterState;

      const projection = projectOntoPolyline(position, corridor.polyline);
      const withinCorridor = projection.offsetM <= MAX_OFFSET_M;

      let aligned = withinCorridor;
      if (withinCorridor && pos.coords.heading != null && Number.isFinite(pos.coords.heading)) {
        const diff = Math.abs(((pos.coords.heading - projection.segmentBearingDeg + 540) % 360) - 180);
        aligned = diff <= MAX_BEARING_DEVIATION_DEG;
      }

      const speed = speedMps ?? 0;
      let recommendation: DriveRecommendation | null = null;
      if (aligned) {
        const result = optimize(
          corridor,
          { timestamp: pos.timestamp, positionM: projection.distanceAlongM, speedMps: speed },
          DEFAULT_CONSTRAINTS,
          lastRecommendationRef.current,
          false,
        );
        recommendation = result.recommendation;
        lastRecommendationRef.current = recommendation;
      } else {
        lastRecommendationRef.current = null;
      }

      lastPositionRef.current = position;

      setState({
        status: "active",
        position,
        timestamp: pos.timestamp,
        speedMps: speed,
        headingDeg: pos.coords.heading ?? null,
        distanceAlongM: withinCorridor ? projection.distanceAlongM : null,
        offCorridorM: projection.offsetM,
        aligned,
        recommendation,
        errorMessage: null,
      });
    },
    [corridor],
  );

  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState((s) => ({ ...s, status: "unsupported" }));
      return;
    }
    setState((s) => ({ ...s, status: "requesting" }));

    const watchId = navigator.geolocation.watchPosition(
      handlePosition,
      (err) => {
        setState((s) => ({
          ...s,
          status: err.code === err.PERMISSION_DENIED ? "denied" : "error",
          errorMessage: err.message,
        }));
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [handlePosition]);

  const stopRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    return () => stopRef.current?.();
  }, []);

  const requestLocation = useCallback(() => {
    const stop = start();
    stopRef.current = stop;
  }, [start]);

  return { ...state, requestLocation };
}
