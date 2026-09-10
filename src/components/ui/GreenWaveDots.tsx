import type { SignalPhaseName, UpcomingLightForecast } from "@/lib/types";

const PHASE_COLOR: Record<SignalPhaseName, string> = {
  green: "bg-accent-green",
  yellow: "bg-accent-amber",
  red: "bg-accent-red",
  unknown: "bg-transparent",
};

const PHASE_LETTER: Record<SignalPhaseName, string> = {
  green: "G",
  yellow: "Y",
  red: "R",
  unknown: "?",
};

export function GreenWaveDots({ upcoming, max = 6 }: { upcoming: UpcomingLightForecast[]; max?: number }) {
  const shown = upcoming.slice(0, max);
  if (shown.length === 0) return null;

  return (
    <div className="flex items-center gap-3">
      {shown.map((light) => {
        const unknown = light.predictedPhaseAtArrival === "unknown";
        return (
          <div key={light.intersectionId} className="flex flex-col items-center gap-1.5">
            <span
              className={`h-2.5 w-2.5 rounded-full ${PHASE_COLOR[light.predictedPhaseAtArrival]} ${
                unknown ? "border border-dashed border-foreground-dim" : ""
              } ${!unknown && light.arrivalConfidence < 0.4 ? "opacity-40" : ""}`}
              aria-hidden
            />
            <span className="text-[10px] font-mono tracking-wide text-foreground-dim">
              {PHASE_LETTER[light.predictedPhaseAtArrival]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
