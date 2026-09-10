import { formatDuration } from "@/lib/geo/units";
import type { DriveMetrics } from "@/lib/types";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="tabular-num text-lg font-semibold text-foreground">{value}</span>
      <span className="text-[10px] font-medium tracking-[0.08em] text-foreground-dim">{label}</span>
    </div>
  );
}

export function MetricsRow({ metrics }: { metrics: DriveMetrics }) {
  return (
    <div className="grid grid-cols-4 gap-2 rounded-xl border border-border-subtle bg-surface px-2 py-3">
      <Stat label="GREENS" value={`${metrics.greensCaught}/${metrics.totalIntersections}`} />
      <Stat label="STOPS" value={String(metrics.stops)} />
      <Stat label="HARD BRAKE" value={String(metrics.hardBrakingEvents)} />
      <Stat label="TRIP TIME" value={formatDuration(metrics.tripTimeSec)} />
    </div>
  );
}
