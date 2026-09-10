import type { SimulationScenario } from "@/lib/types";

const SPEED_OPTIONS = [1, 2, 5, 10] as const;

export function SimulatorControls({
  scenarios,
  selectedScenarioId,
  onSelectScenario,
  running,
  onPlayPause,
  onReset,
  speedMultiplier,
  onSpeedMultiplierChange,
}: {
  scenarios: SimulationScenario[];
  selectedScenarioId: string;
  onSelectScenario: (id: string) => void;
  running: boolean;
  onPlayPause: () => void;
  onReset: () => void;
  speedMultiplier: number;
  onSpeedMultiplierChange: (mult: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium tracking-[0.1em] text-foreground-dim">SCENARIO</span>
        <select
          className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-foreground focus:border-accent-blue focus:outline-none"
          value={selectedScenarioId}
          onChange={(e) => onSelectScenario(e.target.value)}
        >
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-2">
        <button
          onClick={onPlayPause}
          className="flex-1 rounded-lg bg-accent-green px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 active:opacity-80"
        >
          {running ? "Pause" : "Play"}
        </button>
        <button
          onClick={onReset}
          className="rounded-lg border border-border-subtle px-4 py-2.5 text-sm font-medium text-foreground-muted transition-colors hover:border-foreground-dim hover:text-foreground"
        >
          Reset
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium tracking-[0.1em] text-foreground-dim">SPEED</span>
        {SPEED_OPTIONS.map((mult) => (
          <button
            key={mult}
            onClick={() => onSpeedMultiplierChange(mult)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              speedMultiplier === mult
                ? "bg-accent-blue text-background"
                : "bg-surface text-foreground-muted hover:text-foreground"
            }`}
          >
            {mult}×
          </button>
        ))}
      </div>
    </div>
  );
}
