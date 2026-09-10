"use client";

import { useState } from "react";
import Link from "next/link";
import { useGeolocationDrive } from "./useGeolocationDrive";
import { applyOverrides } from "@/lib/storage/calibrationStorage";
import { demoCorridors } from "@/lib/data/corridors/demoCorridor";
import { RecommendationHero } from "@/components/ui/RecommendationHero";
import { UpcomingLightsList } from "@/components/ui/UpcomingLightsList";
import { SafetyDisclaimer } from "@/components/ui/SafetyDisclaimer";
import { DataSourceBadge, SpeedLimitBadge } from "@/components/ui/SpeedLimitBadge";
import { CorridorMap } from "@/components/map/CorridorMap";
import { formatDistance, roundMph } from "@/lib/geo/units";

export function DriveView() {
  const corridors = demoCorridors.map(applyOverrides);
  const [corridorId, setCorridorId] = useState(corridors[0]?.id ?? "");
  const corridor = corridors.find((c) => c.id === corridorId) ?? null;

  const drive = useGeolocationDrive(corridor);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2">
          <span className="text-[11px] font-medium tracking-[0.1em] text-foreground-dim">CORRIDOR</span>
          <select
            className="rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-sm text-foreground focus:border-accent-blue focus:outline-none"
            value={corridorId}
            onChange={(e) => setCorridorId(e.target.value)}
          >
            {corridors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {corridor && <DataSourceBadge label={corridor.dataSourceLabel} />}
      </div>

      {drive.status === "idle" && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border-subtle bg-surface p-10 text-center">
          <p className="max-w-sm text-sm text-foreground-muted">
            Drive Mode uses your device&apos;s location to project your position onto the selected corridor and
            recommend a speed in real time.
          </p>
          <button
            onClick={drive.requestLocation}
            className="rounded-lg bg-accent-green px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
          >
            Enable Location
          </button>
          <Link href="/simulator" className="text-xs text-foreground-dim underline decoration-dotted underline-offset-4">
            Or try the Simulator instead
          </Link>
        </div>
      )}

      {drive.status === "requesting" && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border-subtle bg-surface p-10 text-center">
          <p className="text-sm text-foreground-muted">Requesting location…</p>
        </div>
      )}

      {(drive.status === "denied" || drive.status === "unsupported" || drive.status === "error") && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-accent-amber/30 bg-accent-amber/5 p-10 text-center">
          <p className="text-sm font-medium text-accent-amber">
            {drive.status === "denied" && "Location access was denied."}
            {drive.status === "unsupported" && "Geolocation isn't supported in this browser."}
            {drive.status === "error" && `Location error: ${drive.errorMessage ?? "unknown"}`}
          </p>
          <p className="max-w-sm text-xs text-foreground-dim">
            Drive Mode needs location access to work. The Simulator gives you the full experience without it.
          </p>
          <Link
            href="/simulator"
            className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-foreground-dim"
          >
            Open Simulator
          </Link>
        </div>
      )}

      {drive.status === "active" && corridor && (
        <>
          {!drive.aligned && (
            <div className="rounded-xl border border-accent-amber/30 bg-accent-amber/5 p-4 text-center">
              <p className="text-sm font-medium text-accent-amber">
                {drive.offCorridorM != null && drive.offCorridorM > 40
                  ? "Too far from the selected corridor for a reliable recommendation."
                  : "Heading doesn't match the corridor direction — recommendation unavailable."}
              </p>
              <p className="mt-1 text-xs text-foreground-dim">
                Currently {roundMph(drive.speedMps)} mph
                {drive.offCorridorM != null ? ` · ${formatDistance(drive.offCorridorM)} from corridor` : ""}
              </p>
            </div>
          )}

          {drive.aligned && (
            <div className="rounded-xl border border-border-subtle bg-surface p-5 sm:p-8">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs text-foreground-dim">{corridor.name}</span>
                <SpeedLimitBadge speedLimitMps={corridor.speedLimitMps} />
              </div>
              <RecommendationHero recommendation={drive.recommendation} />
            </div>
          )}

          <CorridorMap
            corridor={corridor}
            vehiclePositionM={drive.distanceAlongM ?? undefined}
            timestamp={drive.timestamp ?? drive.recommendation?.timestamp ?? 0}
            compact
            className="h-72 w-full sm:h-96"
          />

          {drive.aligned && (
            <div className="rounded-xl border border-border-subtle bg-surface p-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">Upcoming Lights</h3>
              <UpcomingLightsList upcoming={drive.recommendation?.upcoming ?? []} />
            </div>
          )}
        </>
      )}

      <SafetyDisclaimer className="mt-auto" />
    </div>
  );
}
