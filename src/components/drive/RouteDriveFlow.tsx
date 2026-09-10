"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { OsrmRoutingProvider, RoutingUnavailableError } from "@/lib/routing/OsrmRoutingProvider";
import { OsmTrafficSignalDiscoveryProvider, SignalDiscoveryUnavailableError } from "@/lib/signals/discovery/OsmTrafficSignalDiscoveryProvider";
import { buildRouteCorridor } from "@/lib/routing/routeCorridor";
import { ChainedSignalTimingProvider } from "@/lib/providers/ChainedSignalTimingProvider";
import { LearnedSignalTimingProvider } from "@/lib/providers/LearnedSignalTimingProvider";
import { ManualSignalTimingProvider } from "@/lib/providers/ManualSignalTimingProvider";
import { getCachedRoute, getCachedSignals, setCachedRoute, setCachedSignals } from "@/lib/storage/routeCache";
import { addRecentDestination } from "@/lib/storage/recentDestinations";
import { projectOntoPolyline } from "@/lib/geo/distance";
import { initialSpeedFilterState, updateSpeedFilter } from "@/lib/geo/speedFilter";
import { optimize, DEFAULT_CONSTRAINTS } from "@/lib/optimizer/optimizer";
import { ObservationTracker, makeManualObservation } from "@/lib/learning/observationTracker";
import { DriveSessionRecorder, type DrivePostSummary } from "@/lib/driveSession/DriveSessionRecorder";
import { useOrigin } from "./useOrigin";
import { useWakeLock } from "./useWakeLock";
import { DestinationSearch } from "./DestinationSearch";
import { RoutePreview, type PreDriveDiagnostics } from "./RoutePreview";
import { RouteDriveActive } from "./RouteDriveActive";
import { DriveSummary } from "./DriveSummary";
import { SafetyDisclaimer } from "@/components/ui/SafetyDisclaimer";
import Link from "next/link";
import type { Corridor, DestinationCandidate, DriveRecommendation, LatLng, Route } from "@/lib/types";

type Step = "destination" | "preparing" | "preview" | "active" | "summary";

const OFF_ROUTE_THRESHOLD_M = 50;
const OFF_ROUTE_CONFIRM_TICKS = 3;
const ARRIVAL_RADIUS_M = 30;

export function RouteDriveFlow() {
  const routingProvider = useMemo(() => new OsrmRoutingProvider(), []);
  const discoveryProvider = useMemo(() => new OsmTrafficSignalDiscoveryProvider(), []);

  const origin = useOrigin();
  const [step, setStep] = useState<Step>("destination");
  const [destination, setDestination] = useState<DestinationCandidate | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [corridor, setCorridor] = useState<Corridor | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DrivePostSummary | null>(null);

  const [liveRecommendation, setLiveRecommendation] = useState<DriveRecommendation | null>(null);
  const [livePositionM, setLivePositionM] = useState(0);
  const [liveTimestamp, setLiveTimestamp] = useState(() => Date.now());
  const [offRoute, setOffRoute] = useState(false);
  const [rerouting, setRerouting] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const recorderRef = useRef<DriveSessionRecorder | null>(null);
  const trackerRef = useRef(new ObservationTracker());
  const speedFilterRef = useRef(initialSpeedFilterState);
  const lastRecommendationRef = useRef<DriveRecommendation | null>(null);
  const driveStartTimestampRef = useRef<number>(0);
  const maxDistanceMRef = useRef(0);
  const offRouteStreakRef = useRef(0);
  const lastPositionRef = useRef<LatLng | null>(null);

  useWakeLock(step === "active");

  // Auto-request location on load — the primary flow shouldn't require an extra tap for this.
  useEffect(() => {
    origin.requestOrigin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function buildRouteAndCorridor(originPt: LatLng, destPt: LatLng, label: string) {
    let nextRoute = getCachedRoute(originPt, destPt);
    if (!nextRoute) {
      nextRoute = await routingProvider.getRoute(originPt, destPt);
      setCachedRoute(originPt, destPt, nextRoute);
    }
    nextRoute = { ...nextRoute, destinationLabel: label };

    let signals = getCachedSignals(nextRoute.routeHash);
    if (!signals) {
      signals = await discoveryProvider.getSignalsNearRoute(nextRoute);
      setCachedSignals(nextRoute.routeHash, signals);
    }

    const timingProvider = new ChainedSignalTimingProvider([
      new ManualSignalTimingProvider(),
      new LearnedSignalTimingProvider(),
    ]);
    const nextCorridor = await buildRouteCorridor(nextRoute, signals, timingProvider);
    return { route: nextRoute, corridor: nextCorridor };
  }

  async function handleSelectDestination(candidate: DestinationCandidate) {
    if (!origin.origin) return;
    setDestination(candidate);
    addRecentDestination(candidate);
    setStep("preparing");
    setPrepError(null);
    try {
      const { route: nextRoute, corridor: nextCorridor } = await buildRouteAndCorridor(origin.origin, candidate.location, candidate.name);
      setRoute(nextRoute);
      setCorridor(nextCorridor);
      setStep("preview");
    } catch (err) {
      const message =
        err instanceof RoutingUnavailableError || err instanceof SignalDiscoveryUnavailableError
          ? err.message
          : "Something went wrong preparing the route.";
      setPrepError(message);
      setStep("destination");
    }
  }

  function handleStartDrive() {
    if (!origin.origin || !destination || !route) return;
    recorderRef.current = new DriveSessionRecorder(origin.origin, destination.location, destination.name, route.id, route.routeHash);
    trackerRef.current = new ObservationTracker();
    speedFilterRef.current = initialSpeedFilterState;
    lastRecommendationRef.current = null;
    driveStartTimestampRef.current = Date.now();
    maxDistanceMRef.current = 0;
    offRouteStreakRef.current = 0;
    setOffRoute(false);
    setGpsError(null);
    setStep("active");
  }

  async function handleReroute(currentPosition: LatLng) {
    if (!destination || rerouting) return;
    setRerouting(true);
    try {
      const { route: nextRoute, corridor: nextCorridor } = await buildRouteAndCorridor(currentPosition, destination.location, destination.name);
      setRoute(nextRoute);
      setCorridor(nextCorridor);
      trackerRef.current.reset();
      lastRecommendationRef.current = null;
      offRouteStreakRef.current = 0;
      setOffRoute(false);
    } catch {
      // Reroute failed (offline, upstream error) — keep the last known route/corridor
      // rather than leaving the driver with nothing; off-route banner stays up.
    } finally {
      setRerouting(false);
    }
  }

  async function finishDrive() {
    if (!recorderRef.current) return;
    const durationSec = (Date.now() - driveStartTimestampRef.current) / 1000;
    const finalSummary = await recorderRef.current.finish({ distanceM: maxDistanceMRef.current, durationSec });
    setSummary(finalSummary);
    setStep("summary");
  }

  // Active-driving GPS watch.
  useEffect(() => {
    if (step !== "active" || !corridor) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      queueMicrotask(() => setGpsError("Geolocation isn't supported in this browser."));
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const position: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        lastPositionRef.current = position;
        const { state: nextFilterState, speedMps } = updateSpeedFilter(speedFilterRef.current, {
          timestamp: pos.timestamp,
          position,
          reportedSpeedMps: pos.coords.speed,
        });
        speedFilterRef.current = nextFilterState;
        const speed = speedMps ?? 0;

        const projection = projectOntoPolyline(position, corridor.polyline);
        const isOffRoute = projection.offsetM > OFF_ROUTE_THRESHOLD_M;

        if (isOffRoute) {
          offRouteStreakRef.current += 1;
          if (offRouteStreakRef.current >= OFF_ROUTE_CONFIRM_TICKS) {
            setOffRoute(true);
            void handleReroute(position);
          }
          setLiveTimestamp(pos.timestamp);
          return;
        }
        offRouteStreakRef.current = 0;
        setOffRoute(false);

        const vehicle = { timestamp: pos.timestamp, positionM: projection.distanceAlongM, speedMps: speed };
        const result = optimize(corridor, vehicle, DEFAULT_CONSTRAINTS, lastRecommendationRef.current, false);
        lastRecommendationRef.current = result.recommendation;

        recorderRef.current?.recordTick(vehicle, result.recommendation, corridor);
        const events = trackerRef.current.processTick(
          { timestamp: pos.timestamp, positionM: projection.distanceAlongM, speedMps: speed, position, routeHeadingDeg: projection.segmentBearingDeg },
          corridor.intersections.map((i) => ({ id: i.id, distanceAlongCorridorM: i.distanceAlongCorridorM })),
        );
        recorderRef.current?.recordObservations(events);

        maxDistanceMRef.current = Math.max(maxDistanceMRef.current, projection.distanceAlongM);
        setLiveRecommendation(result.recommendation);
        setLivePositionM(projection.distanceAlongM);
        setLiveTimestamp(pos.timestamp);

        const totalRouteM = corridor.intersections.length > 0
          ? Math.max(corridor.polyline.length, projection.distanceAlongM)
          : projection.distanceAlongM;
        const remainingM = (route?.distanceM ?? totalRouteM) - projection.distanceAlongM;
        if (remainingM <= ARRIVAL_RADIUS_M) {
          void finishDrive();
        }
      },
      (err) => setGpsError(err.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, corridor]);

  function handleTapWhenGreen(signalId: string) {
    if (!lastPositionRef.current || !corridor) return;
    const signal = corridor.intersections.find((i) => i.id === signalId);
    if (!signal) return;
    const distanceToSignalM = signal.distanceAlongCorridorM - livePositionM;
    const event = makeManualObservation(
      signalId,
      "GREEN_START_MANUAL",
      {
        timestamp: Date.now(),
        positionM: livePositionM,
        speedMps: lastRecommendationRef.current?.targetSpeedMps ?? 0,
        position: lastPositionRef.current,
        routeHeadingDeg: 0,
      },
      distanceToSignalM,
    );
    recorderRef.current?.recordManualObservation(event);
  }

  async function handleExportDebugJson() {
    if (!recorderRef.current) return {};
    return recorderRef.current.exportDebugJson();
  }

  const diagnostics: PreDriveDiagnostics = {
    location: origin.status === "ready" ? "ready" : origin.status === "requesting" ? "pending" : "unavailable",
    routing: prepError ? "unavailable" : "ready",
    route: route ? "ready" : "pending",
    gps: typeof navigator !== "undefined" && navigator.geolocation ? "ready" : "unavailable",
    network: typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine ? "unavailable" : "ready",
  };

  const nextUnknownSignal = useMemo(() => {
    const next = liveRecommendation?.upcoming.find((u) => u.predictedPhaseAtArrival === "unknown");
    if (!next) return null;
    return { id: next.intersectionId, name: next.name };
  }, [liveRecommendation]);

  if (step === "summary" && summary) {
    return <DriveSummary summary={summary} onExportDebugJson={handleExportDebugJson} />;
  }

  if (step === "active" && corridor) {
    return (
      <RouteDriveActive
        corridor={corridor}
        recommendation={liveRecommendation}
        positionM={livePositionM}
        timestamp={liveTimestamp}
        offRoute={offRoute}
        rerouting={rerouting}
        nextUnknownSignal={nextUnknownSignal}
        onTapWhenGreen={handleTapWhenGreen}
      />
    );
  }

  if (step === "preview" && route && corridor) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <RoutePreview route={route} corridor={corridor} diagnostics={diagnostics} onStartDrive={handleStartDrive} />
        <SafetyDisclaimer className="mt-auto text-center" />
      </div>
    );
  }

  // "destination" and "preparing" steps.
  return (
    <div className="flex flex-1 flex-col gap-5 p-4 sm:p-6">
      {origin.status === "denied" || origin.status === "unsupported" || origin.status === "error" ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-accent-amber/30 bg-accent-amber/5 p-6 text-center">
          <p className="text-sm font-medium text-accent-amber">
            {origin.status === "denied" && "Location access was denied."}
            {origin.status === "unsupported" && "Geolocation isn't supported in this browser."}
            {origin.status === "error" && `Location error: ${origin.errorMessage ?? "unknown"}`}
          </p>
          <p className="max-w-sm text-xs text-foreground-dim">Location required for Drive Mode.</p>
          <button
            onClick={origin.requestOrigin}
            className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-foreground-dim"
          >
            Try Again
          </button>
        </div>
      ) : (
        <DestinationSearch origin={origin.origin} provider={routingProvider} onSelect={handleSelectDestination} />
      )}

      {step === "preparing" && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border-subtle bg-surface p-8 text-center">
          <p className="text-sm text-foreground-muted">Calculating route and finding traffic signals…</p>
        </div>
      )}

      {prepError && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-accent-amber/30 bg-accent-amber/5 p-6 text-center">
          <p className="text-sm font-medium text-accent-amber">{prepError}</p>
        </div>
      )}

      {gpsError && <p className="text-center text-xs text-accent-amber">{gpsError}</p>}

      <div className="mt-auto flex flex-col items-center gap-2 border-t border-border-subtle pt-4 text-center">
        <p className="text-xs text-foreground-dim">Prefer to try it without a real route?</p>
        <div className="flex gap-4">
          <Link href="/simulator" className="text-xs text-foreground-muted underline decoration-dotted underline-offset-4">
            Open Simulator
          </Link>
          <Link href="/drive/corridor" className="text-xs text-foreground-muted underline decoration-dotted underline-offset-4">
            Use a preset corridor
          </Link>
        </div>
      </div>
      <SafetyDisclaimer className="text-center" />
    </div>
  );
}
