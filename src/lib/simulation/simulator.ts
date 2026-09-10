import { DEFAULT_CONSTRAINTS, optimize } from "@/lib/optimizer/optimizer";
import { getSignalPhaseAtTime } from "@/lib/signals/signalEngine";
import { mphToMps } from "@/lib/geo/units";
import type {
  Corridor,
  DriveMetrics,
  DriveRecommendation,
  OptimizerConstraints,
  SimulationScenario,
  SimulationState,
} from "@/lib/types";

/**
 * Deterministic drive simulator. Time only advances when `tick()` is
 * called, driven by an explicit `dtRealMs * speedMultiplier` — it never
 * reads `Date.now()` or `performance.now()` internally, so simulated
 * signal timing is completely decoupled from wall-clock time.
 */

const HARD_BRAKE_DECEL_MPS2 = 2.8;
const HARD_ACCEL_MPS2 = 2.2;

function initialState(corridor: Corridor, scenario: SimulationScenario): SimulationState {
  return {
    timestamp: scenario.startTimestamp,
    running: false,
    speedMultiplier: 1,
    corridor,
    vehicle: {
      timestamp: scenario.startTimestamp,
      positionM: scenario.startPositionM,
      speedMps: scenario.startSpeedMps,
    },
    finished: false,
    metrics: {
      stops: 0,
      hardBrakingEvents: 0,
      hardAccelEvents: 0,
      greensCaught: 0,
      totalIntersections: corridor.intersections.filter((i) => i.distanceAlongCorridorM > scenario.startPositionM)
        .length,
      tripTimeSec: 0,
      distanceM: 0,
    },
    lastResult: null,
    history: [],
  };
}

export class DriveSimulator {
  private state: SimulationState;
  private constraints: OptimizerConstraints;
  /** Follow the recommended speed automatically ("green-wave" mode) vs. a fixed baseline speed ("normal drive" mode). */
  private mode: "optimized" | "baseline";
  private baselineTargetMps: number;
  private caughtGreenIds = new Set<string>();
  private stoppedIntersectionIds = new Set<string>();
  private startPositionM: number;

  constructor(
    corridor: Corridor,
    scenario: SimulationScenario,
    options: { mode?: "optimized" | "baseline"; constraints?: OptimizerConstraints } = {},
  ) {
    this.state = initialState(corridor, scenario);
    this.constraints = options.constraints ?? DEFAULT_CONSTRAINTS;
    this.mode = options.mode ?? "optimized";
    this.baselineTargetMps = Math.min(corridor.speedLimitMps, scenario.startSpeedMps || mphToMps(21));
    this.startPositionM = scenario.startPositionM;
    this.state.lastResult = optimize(corridor, this.state.vehicle, this.constraints, null, false);
  }

  getState(): SimulationState {
    return this.state;
  }

  play() {
    this.state = { ...this.state, running: true };
  }

  pause() {
    this.state = { ...this.state, running: false };
  }

  reset(scenario: SimulationScenario) {
    this.state = initialState(this.state.corridor, scenario);
    this.caughtGreenIds.clear();
    this.stoppedIntersectionIds.clear();
    this.startPositionM = scenario.startPositionM;
    this.state.lastResult = optimize(this.state.corridor, this.state.vehicle, this.constraints, null, false);
  }

  setSpeedMultiplier(multiplier: number) {
    this.state = { ...this.state, speedMultiplier: multiplier };
  }

  /** Advances the simulation by `dtRealMs` of wall-clock time, scaled by speedMultiplier. */
  tick(dtRealMs: number): SimulationState {
    if (!this.state.running || this.state.finished) return this.state;

    const dtSimMs = dtRealMs * this.state.speedMultiplier;
    const dtSimSec = dtSimMs / 1000;
    const corridor = this.state.corridor;
    const prevVehicle = this.state.vehicle;
    const prevSpeed = prevVehicle.speedMps;

    const previousRecommendation: DriveRecommendation | null = this.state.lastResult?.recommendation ?? null;

    let targetSpeedMps: number;
    if (this.mode === "baseline") {
      targetSpeedMps = Math.min(this.baselineTargetMps, corridor.speedLimitMps);
    } else {
      const result = optimize(corridor, prevVehicle, this.constraints, previousRecommendation, false);
      targetSpeedMps = result.recommendation.targetSpeedMps;
      this.state = { ...this.state, lastResult: result };
    }

    // Move the vehicle's actual speed toward the target using comfortable accel/decel caps.
    const rate = targetSpeedMps >= prevSpeed ? this.constraints.maxAcceleration : this.constraints.maxComfortableDeceleration;
    const maxDelta = rate * dtSimSec;
    const delta = targetSpeedMps - prevSpeed;
    const appliedDelta = Math.abs(delta) <= maxDelta ? delta : Math.sign(delta) * maxDelta;
    const actualRate = dtSimSec > 0 ? appliedDelta / dtSimSec : 0;

    if (actualRate < -HARD_BRAKE_DECEL_MPS2) this.state.metrics.hardBrakingEvents += 1;
    if (actualRate > HARD_ACCEL_MPS2) this.state.metrics.hardAccelEvents += 1;

    const newSpeed = Math.max(0, prevSpeed + appliedDelta);
    // Trapezoidal distance integration for better accuracy than a simple Euler step.
    const newPositionM = prevVehicle.positionM + ((prevSpeed + newSpeed) / 2) * dtSimSec;
    const newTimestamp = this.state.timestamp + dtSimMs;

    const newVehicle = { timestamp: newTimestamp, positionM: newPositionM, speedMps: newSpeed };

    // Track stops: a light we've fully passed while near-zero speed counts once.
    if (newSpeed < mphToMps(2)) {
      for (const intersection of corridor.intersections) {
        const nearBy = Math.abs(intersection.distanceAlongCorridorM - newPositionM) < 15;
        if (nearBy && !this.stoppedIntersectionIds.has(intersection.id)) {
          this.stoppedIntersectionIds.add(intersection.id);
          this.state.metrics.stops += 1;
        }
      }
    }

    // Track greens caught: crossing an intersection's position while its signal is green.
    for (const intersection of corridor.intersections) {
      const crossed =
        prevVehicle.positionM < intersection.distanceAlongCorridorM &&
        newPositionM >= intersection.distanceAlongCorridorM;
      if (crossed && !this.caughtGreenIds.has(intersection.id)) {
        this.caughtGreenIds.add(intersection.id);
        const phaseAtCrossing = getSignalPhaseAtTime(intersection.signalPlan, newTimestamp);
        if (phaseAtCrossing === "green") {
          this.state.metrics.greensCaught += 1;
        }
      }
    }

    const lastIntersectionM = corridor.intersections.length
      ? Math.max(...corridor.intersections.map((i) => i.distanceAlongCorridorM))
      : 0;
    const finished = newPositionM >= lastIntersectionM + 100;

    this.state = {
      ...this.state,
      timestamp: newTimestamp,
      vehicle: newVehicle,
      finished,
      metrics: {
        ...this.state.metrics,
        tripTimeSec: this.state.metrics.tripTimeSec + dtSimSec,
        distanceM: newPositionM - this.startPositionM,
      },
      running: finished ? false : this.state.running,
      history: [
        ...this.state.history,
        { timestamp: newTimestamp, positionM: newPositionM, speedMps: newSpeed, targetSpeedMps },
      ].slice(-2000),
    };

    if (this.mode === "optimized") {
      this.state.lastResult = optimize(corridor, newVehicle, this.constraints, previousRecommendation, false);
    }

    return this.state;
  }
}

/**
 * Runs a scenario to completion headlessly (no rendering), used for the
 * baseline-vs-green-wave comparison feature. Uses fixed simulated time
 * steps, not wall-clock time, so results are deterministic.
 */
export function runScenarioToCompletion(
  corridor: Corridor,
  scenario: SimulationScenario,
  mode: "optimized" | "baseline",
  constraints: OptimizerConstraints = DEFAULT_CONSTRAINTS,
): DriveMetrics {
  const sim = new DriveSimulator(corridor, scenario, { mode, constraints });
  sim.play();
  const STEP_MS = 200;
  const MAX_STEPS = 50_000; // 50k * 200ms simulated = ~2.8 simulated hours, ample headroom
  let state = sim.getState();
  for (let i = 0; i < MAX_STEPS && !state.finished; i++) {
    state = sim.tick(STEP_MS);
  }
  return state.metrics;
}
