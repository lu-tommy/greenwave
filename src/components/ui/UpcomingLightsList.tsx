import { formatDistance, formatDuration } from "@/lib/geo/units";
import type { SignalPhaseName, UpcomingLightForecast } from "@/lib/types";

const PHASE_LABEL: Record<SignalPhaseName, string> = {
  green: "GREEN ARRIVAL",
  yellow: "YELLOW ARRIVAL",
  red: "RED ARRIVAL",
  unknown: "UNKNOWN",
};

const PHASE_DOT: Record<SignalPhaseName, string> = {
  green: "bg-accent-green",
  yellow: "bg-accent-amber",
  red: "bg-accent-red",
  unknown: "bg-transparent border border-dashed border-foreground-dim",
};

export function UpcomingLightsList({ upcoming, max = 6 }: { upcoming: UpcomingLightForecast[]; max?: number }) {
  const shown = upcoming.slice(0, max);
  if (shown.length === 0) {
    return <p className="text-sm text-foreground-dim">No upcoming signals in range.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border-subtle">
      {shown.map((light) => {
        const unknown = light.predictedPhaseAtArrival === "unknown";
        return (
          <li key={light.intersectionId} className="flex items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className={`h-2 w-2 shrink-0 rounded-full ${PHASE_DOT[light.predictedPhaseAtArrival]}`} aria-hidden />
              <span className="truncate text-sm font-medium text-foreground">{light.name}</span>
            </div>
            <div className="flex shrink-0 flex-col items-end">
              <span className="text-xs text-foreground-muted">{formatDistance(light.distanceM)}</span>
              <span className="text-[11px] tracking-wide text-foreground-dim">
                {unknown
                  ? PHASE_LABEL.unknown
                  : `${PHASE_LABEL[light.predictedPhaseAtArrival]} · ${formatDuration(light.etaMs / 1000)}${
                      light.arrivalConfidence < 0.5 ? " · LOW CONF." : ""
                    }`}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
