import type { TimeToGreenState } from "@/lib/signalIntelligence/timeToGreen";

/**
 * The "stopped at red" primary display. Deliberately cannot render a
 * countdown to 0 or any "GO"/"safe to enter" implication — see
 * computeTimeToGreen's WATCH_SIGNAL cutoff. This is the other half of the
 * two-state Drive Mode UI (see RouteDriveActive): MOVING gets GLOSA,
 * STOPPED-AT-A-TRUSTWORTHY-RED gets this.
 */
export function TimeToGreenDisplay({ state }: { state: TimeToGreenState }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="text-sm font-semibold tracking-[0.2em] text-accent-red">RED</span>

      {state.status === "COUNTDOWN" && (
        <>
          <div className="flex flex-col items-center leading-none">
            <span className="tabular-num font-mono text-[6.5rem] font-semibold leading-none text-foreground">
              {Math.round(state.secondsToGreen)}
            </span>
            <span className="mt-1 text-sm font-medium tracking-[0.2em] text-foreground-muted">SEC</span>
          </div>
          <span className="text-base font-semibold tracking-wide text-foreground-muted">TO GREEN</span>
        </>
      )}

      {state.status === "WATCH_SIGNAL" && (
        <div className="flex flex-col items-center gap-1 py-6">
          <span className="text-4xl font-semibold tracking-tight text-accent-amber">WATCH</span>
          <span className="text-4xl font-semibold tracking-tight text-accent-amber">SIGNAL</span>
        </div>
      )}

      {state.status === "ESTIMATED_RANGE" && (
        <>
          <div className="flex flex-col items-center leading-none">
            <span className="tabular-num font-mono text-5xl font-semibold leading-none text-foreground">
              ~{Math.round(state.minSec)}–{Math.round(state.maxSec)}
            </span>
            <span className="mt-1 text-sm font-medium tracking-[0.2em] text-foreground-muted">SEC</span>
          </div>
          <span className="text-base font-semibold tracking-wide text-accent-amber">ESTIMATED</span>
        </>
      )}
    </div>
  );
}
