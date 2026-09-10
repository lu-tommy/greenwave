import { formatDistance, roundMph } from "@/lib/geo/units";
import type { DriveRecommendation } from "@/lib/types";
import { GreenWaveDots } from "./GreenWaveDots";
import { instructionAccentClass, instructionLabel } from "./instructionLabel";

export function RecommendationHero({ recommendation }: { recommendation: DriveRecommendation | null }) {
  if (!recommendation) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-foreground-muted">
        <span className="text-sm tracking-wide">NO RECOMMENDATION AVAILABLE</span>
      </div>
    );
  }

  const { instruction, targetSpeedMps, isGreenWave, greenWaveCount, reason, upcoming, confidence } = recommendation;
  const accent = instructionAccentClass(instruction);
  const nextIntersectionDistanceM = upcoming[0]?.distanceM;

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {isGreenWave && (
        <div className="flex items-center gap-1.5 rounded-full border border-accent-green/30 bg-accent-green/10 px-3 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-green" />
          <span className="text-xs font-medium tracking-[0.12em] text-accent-green">
            GREEN WAVE · {greenWaveCount} LIGHT{greenWaveCount === 1 ? "" : "S"}
          </span>
        </div>
      )}

      <div className="flex flex-col items-center leading-none">
        <span className={`tabular-num font-mono text-[6.5rem] font-semibold leading-none ${accent}`}>
          {instruction === "PREPARE_TO_STOP" ? "—" : roundMph(targetSpeedMps)}
        </span>
        {instruction !== "PREPARE_TO_STOP" && (
          <span className="mt-1 text-sm font-medium tracking-[0.2em] text-foreground-muted">MPH</span>
        )}
      </div>

      <span className={`text-base font-semibold tracking-wide ${accent}`}>
        {instructionLabel(instruction, targetSpeedMps)}
      </span>

      {!isGreenWave && <span className="text-xs text-foreground-muted">{reason}</span>}

      {upcoming.length > 0 && (
        <>
          <GreenWaveDots upcoming={upcoming} />
          <span className="text-xs text-foreground-dim">
            {nextIntersectionDistanceM != null ? `${formatDistance(nextIntersectionDistanceM)} to next light` : null}
            {confidence < 0.5 && <span className="ml-2 text-accent-amber">· LOW CONFIDENCE</span>}
          </span>
        </>
      )}
    </div>
  );
}
