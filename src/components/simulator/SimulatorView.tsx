"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DriveSimulator } from "@/lib/simulation/simulator";
import { DEFAULT_CONSTRAINTS, optimize } from "@/lib/optimizer/optimizer";
import { applyOverrides } from "@/lib/storage/calibrationStorage";
import { demoCorridor } from "@/lib/data/corridors/demoCorridor";
import { getScenario, simulationScenarios } from "@/lib/data/corridors/scenarios";
import type { SimulationState } from "@/lib/types";
import { RecommendationHero } from "@/components/ui/RecommendationHero";
import { UpcomingLightsList } from "@/components/ui/UpcomingLightsList";
import { SafetyDisclaimer } from "@/components/ui/SafetyDisclaimer";
import { DataSourceBadge, SpeedLimitBadge } from "@/components/ui/SpeedLimitBadge";
import { DebugPanel } from "@/components/ui/DebugPanel";
import { SimulatorControls } from "./SimulatorControls";
import { MetricsRow } from "./MetricsRow";
import { ComparisonPanel } from "./ComparisonPanel";
import { CorridorMap } from "@/components/map/CorridorMap";
import { roundMph } from "@/lib/geo/units";

export function SimulatorView() {
  const corridor = useMemo(() => applyOverrides(demoCorridor), []);
  const [scenarioId, setScenarioId] = useState<string>(simulationScenarios[0].id);
  const scenario = useMemo(() => getScenario(scenarioId) ?? simulationScenarios[0], [scenarioId]);

  const [sim] = useState(() => new DriveSimulator(corridor, scenario));
  const [state, setState] = useState<SimulationState>(() => sim.getState());
  const [debugOpen, setDebugOpen] = useState(false);

  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    function loop(ts: number) {
      if (lastTsRef.current != null) {
        const dt = Math.min(ts - lastTsRef.current, 250); // clamp to avoid huge jumps after a tab is backgrounded
        setState(sim.tick(dt));
      }
      lastTsRef.current = ts;
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [sim]);

  function handleSelectScenario(id: string) {
    setScenarioId(id);
    const next = getScenario(id);
    if (next) {
      sim.reset(next);
      setState(sim.getState());
    }
  }

  function handlePlayPause() {
    if (state.running) sim.pause();
    else sim.play();
    setState(sim.getState());
  }

  function handleReset() {
    sim.reset(scenario);
    setState(sim.getState());
  }

  function handleSpeedMultiplierChange(mult: number) {
    sim.setSpeedMultiplier(mult);
    setState({ ...sim.getState() });
  }

  const recommendation = state.lastResult?.recommendation ?? null;
  const debugResult = debugOpen ? optimize(corridor, state.vehicle, DEFAULT_CONSTRAINTS, recommendation, true) : null;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:grid lg:grid-cols-[1fr_360px] lg:gap-5 lg:p-6">
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border-subtle bg-surface p-5 sm:p-8">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DataSourceBadge label={corridor.dataSourceLabel} />
              <span className="text-xs text-foreground-dim">{corridor.name}</span>
            </div>
            <SpeedLimitBadge speedLimitMps={corridor.speedLimitMps} />
          </div>
          <RecommendationHero recommendation={recommendation} />
        </div>

        <CorridorMap
          corridor={corridor}
          vehiclePositionM={state.vehicle.positionM}
          timestamp={state.timestamp}
          className="h-72 w-full sm:h-96"
        />

        <MetricsRow metrics={state.metrics} />

        <ComparisonPanel corridor={corridor} scenario={scenario} />
      </div>

      <aside className="flex flex-col gap-4">
        <div className="rounded-xl border border-border-subtle bg-surface p-4">
          <SimulatorControls
            scenarios={simulationScenarios}
            selectedScenarioId={scenarioId}
            onSelectScenario={handleSelectScenario}
            running={state.running}
            onPlayPause={handlePlayPause}
            onReset={handleReset}
            speedMultiplier={state.speedMultiplier}
            onSpeedMultiplierChange={handleSpeedMultiplierChange}
          />
          <p className="mt-3 text-xs leading-relaxed text-foreground-dim">{scenario.description}</p>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Upcoming Lights</h3>
            <span className="tabular-num text-xs text-foreground-dim">{roundMph(state.vehicle.speedMps)} mph now</span>
          </div>
          <UpcomingLightsList upcoming={recommendation?.upcoming ?? []} />
        </div>

        <button
          onClick={() => setDebugOpen((v) => !v)}
          className="self-start text-xs text-foreground-dim underline decoration-dotted underline-offset-4 hover:text-foreground-muted"
        >
          {debugOpen ? "Hide" : "Show"} engine debug panel
        </button>
        {debugOpen && <DebugPanel state={state} result={debugResult} />}

        <SafetyDisclaimer className="mt-auto" />
      </aside>
    </div>
  );
}
