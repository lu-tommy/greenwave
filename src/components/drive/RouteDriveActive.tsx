import { RecommendationHero } from "@/components/ui/RecommendationHero";
import { UpcomingLightsList } from "@/components/ui/UpcomingLightsList";
import { SafetyDisclaimer } from "@/components/ui/SafetyDisclaimer";
import { DataSourceBadge, SpeedLimitBadge } from "@/components/ui/SpeedLimitBadge";
import { CorridorMap } from "@/components/map/CorridorMap";
import type { Corridor, DriveRecommendation } from "@/lib/types";

export function RouteDriveActive({
  corridor,
  recommendation,
  positionM,
  timestamp,
  offRoute,
  rerouting,
  nextUnknownSignal,
  onTapWhenGreen,
}: {
  corridor: Corridor;
  recommendation: DriveRecommendation | null;
  positionM: number;
  timestamp: number;
  offRoute: boolean;
  rerouting: boolean;
  nextUnknownSignal: { id: string; name: string } | null;
  onTapWhenGreen: (signalId: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:p-6">
      {offRoute && (
        <div className="rounded-xl border border-accent-amber/30 bg-accent-amber/5 p-4 text-center">
          <p className="text-sm font-semibold text-accent-amber">OFF ROUTE</p>
          <p className="mt-1 text-xs text-foreground-dim">{rerouting ? "Recalculating…" : "Waiting for a clear GPS fix…"}</p>
        </div>
      )}

      <div className="rounded-xl border border-border-subtle bg-surface p-5 sm:p-8">
        <div className="mb-4 flex items-center justify-between">
          <DataSourceBadge label={corridor.dataSourceLabel} />
          <SpeedLimitBadge speedLimitMps={corridor.speedLimitMps} />
        </div>
        <RecommendationHero recommendation={offRoute ? null : recommendation} />

        {!offRoute && nextUnknownSignal && (
          <button
            onClick={() => onTapWhenGreen(nextUnknownSignal.id)}
            className="mt-5 w-full rounded-xl border-2 border-dashed border-foreground-dim py-4 text-sm font-semibold tracking-wide text-foreground-muted transition-colors hover:border-accent-green hover:text-accent-green active:opacity-80"
          >
            TAP WHEN GREEN — {nextUnknownSignal.name}
          </button>
        )}
      </div>

      <CorridorMap corridor={corridor} vehiclePositionM={positionM} timestamp={timestamp} compact className="h-56 w-full sm:h-72" />

      <div className="rounded-xl border border-border-subtle bg-surface p-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Upcoming Lights</h3>
        <UpcomingLightsList upcoming={recommendation?.upcoming ?? []} />
      </div>

      <SafetyDisclaimer className="mt-auto" />
    </div>
  );
}
