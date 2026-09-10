import { mpsToMph } from "@/lib/geo/units";
import type { OptimizationResult, SimulationState } from "@/lib/types";

/**
 * Developer/tuning panel: every candidate speed considered, its score, and
 * the chosen recommendation. Hidden by default in the driving experience —
 * opt-in via a toggle in the simulator/drive views.
 */
export function DebugPanel({ state, result }: { state: SimulationState; result: OptimizationResult | null }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-3 font-mono text-[11px]">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-foreground-muted">
        <span>sim time</span>
        <span className="text-right text-foreground">{new Date(state.timestamp).toISOString().slice(11, 19)}</span>
        <span>position</span>
        <span className="text-right text-foreground">{state.vehicle.positionM.toFixed(1)} m</span>
        <span>speed</span>
        <span className="text-right text-foreground">{mpsToMph(state.vehicle.speedMps).toFixed(1)} mph</span>
      </div>

      {result && (
        <div className="flex flex-col gap-1">
          <div className="text-foreground-muted">candidates ({result.candidates.length})</div>
          <div className="max-h-40 overflow-y-auto">
            <table className="w-full text-left">
              <thead className="text-foreground-dim">
                <tr>
                  <th className="pr-2 font-normal">mph</th>
                  <th className="pr-2 font-normal">score</th>
                  <th className="pr-2 font-normal">greens</th>
                  <th className="pr-2 font-normal">stops</th>
                  <th className="font-normal">hardB/A</th>
                </tr>
              </thead>
              <tbody>
                {result.candidates.map((c, idx) => {
                  const chosen = Math.abs(c.speedMps - result.recommendation.targetSpeedMps) < 0.01;
                  return (
                    <tr key={idx} className={chosen ? "text-accent-green" : "text-foreground-muted"}>
                      <td className="pr-2">{mpsToMph(c.speedMps).toFixed(1)}</td>
                      <td className="pr-2">{c.score.toFixed(1)}</td>
                      <td className="pr-2">{c.greensCaught}</td>
                      <td className="pr-2">{c.stopsRequired}</td>
                      <td>
                        {c.hardBrakingEvents}/{c.hardAccelEvents}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
