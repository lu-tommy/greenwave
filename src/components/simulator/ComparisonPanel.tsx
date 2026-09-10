"use client";

import { useState } from "react";
import { formatDuration } from "@/lib/geo/units";
import { runScenarioToCompletion } from "@/lib/simulation/simulator";
import type { Corridor, DriveMetrics, SimulationScenario } from "@/lib/types";

function Row({ label, normal, greenWave, betterWhenLower }: { label: string; normal: number; greenWave: number; betterWhenLower: boolean }) {
  const improved = betterWhenLower ? greenWave < normal : greenWave > normal;
  const worse = betterWhenLower ? greenWave > normal : greenWave < normal;
  return (
    <div className="grid grid-cols-3 items-center gap-2 py-1.5 text-sm">
      <span className="text-foreground-muted">{label}</span>
      <span className="tabular-num text-right text-foreground">{normal}</span>
      <span
        className={`tabular-num text-right font-semibold ${
          improved ? "text-accent-green" : worse ? "text-accent-red" : "text-foreground"
        }`}
      >
        {greenWave}
      </span>
    </div>
  );
}

export function ComparisonPanel({ corridor, scenario }: { corridor: Corridor; scenario: SimulationScenario }) {
  const [result, setResult] = useState<{ baseline: DriveMetrics; optimized: DriveMetrics } | null>(null);
  const [running, setRunning] = useState(false);

  function runComparison() {
    setRunning(true);
    // Deferred to keep the click responsive; the computation itself is synchronous and fast.
    setTimeout(() => {
      const baseline = runScenarioToCompletion(corridor, scenario, "baseline");
      const optimized = runScenarioToCompletion(corridor, scenario, "optimized");
      setResult({ baseline, optimized });
      setRunning(false);
    }, 0);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Normal Drive vs. Green Wave</h3>
        <button
          onClick={runComparison}
          disabled={running}
          className="rounded-md bg-surface-raised px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-border-subtle disabled:opacity-50"
        >
          {running ? "Running…" : "Run Comparison"}
        </button>
      </div>

      {result && (
        <div className="flex flex-col">
          <div className="grid grid-cols-3 gap-2 border-b border-border-subtle pb-1.5 text-[11px] font-medium tracking-wide text-foreground-dim">
            <span />
            <span className="text-right">NORMAL</span>
            <span className="text-right">GREEN WAVE</span>
          </div>
          <Row label="Stops" normal={result.baseline.stops} greenWave={result.optimized.stops} betterWhenLower />
          <Row
            label="Hard braking"
            normal={result.baseline.hardBrakingEvents}
            greenWave={result.optimized.hardBrakingEvents}
            betterWhenLower
          />
          <Row
            label="Greens caught"
            normal={result.baseline.greensCaught}
            greenWave={result.optimized.greensCaught}
            betterWhenLower={false}
          />
          <div className="grid grid-cols-3 items-center gap-2 py-1.5 text-sm">
            <span className="text-foreground-muted">Trip time</span>
            <span className="tabular-num text-right text-foreground">{formatDuration(result.baseline.tripTimeSec)}</span>
            <span
              className={`tabular-num text-right font-semibold ${
                result.optimized.tripTimeSec < result.baseline.tripTimeSec ? "text-accent-green" : "text-foreground"
              }`}
            >
              {formatDuration(result.optimized.tripTimeSec)}
            </span>
          </div>
          {result.optimized.stops >= result.baseline.stops && result.optimized.greensCaught <= result.baseline.greensCaught && (
            <p className="mt-2 text-xs text-foreground-dim">
              In this scenario the green-wave strategy did not clearly outperform normal driving — shown honestly, not adjusted.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
