import { describe, expect, it } from "vitest";
import { DriveSimulator, runScenarioToCompletion } from "./simulator";
import { demoCorridor } from "@/lib/data/corridors/demoCorridor";
import { getScenario } from "@/lib/data/corridors/scenarios";

const scenario = getScenario("perfect-green-wave")!;

describe("DriveSimulator", () => {
  it("does not advance time or position while paused", () => {
    const sim = new DriveSimulator(demoCorridor, scenario);
    const before = sim.getState();
    sim.tick(1000);
    const after = sim.getState();
    expect(after.timestamp).toBe(before.timestamp);
    expect(after.vehicle.positionM).toBe(before.vehicle.positionM);
  });

  it("advances simulated time independently of wall-clock time, scaled by speedMultiplier", () => {
    const sim = new DriveSimulator(demoCorridor, scenario);
    sim.setSpeedMultiplier(10);
    sim.play();
    const before = sim.getState().timestamp;
    sim.tick(100); // 100ms real time * 10x = 1000ms simulated
    const after = sim.getState().timestamp;
    expect(after - before).toBe(1000);
  });

  it("moves the vehicle forward while running", () => {
    const sim = new DriveSimulator(demoCorridor, scenario);
    sim.play();
    const before = sim.getState().vehicle.positionM;
    for (let i = 0; i < 50; i++) sim.tick(200);
    const after = sim.getState().vehicle.positionM;
    expect(after).toBeGreaterThan(before);
  });

  it("never assigns a speed above the corridor speed limit during optimized-mode driving", () => {
    const sim = new DriveSimulator(demoCorridor, scenario, { mode: "optimized" });
    sim.setSpeedMultiplier(20);
    sim.play();
    for (let i = 0; i < 300; i++) {
      const state = sim.tick(250);
      expect(state.vehicle.speedMps).toBeLessThanOrEqual(demoCorridor.speedLimitMps + 1e-6);
      if (state.finished) break;
    }
  });

  it("eventually finishes after traveling the full corridor", () => {
    const sim = new DriveSimulator(demoCorridor, scenario);
    sim.setSpeedMultiplier(30);
    sim.play();
    let finished = false;
    for (let i = 0; i < 2000; i++) {
      const state = sim.tick(250);
      if (state.finished) {
        finished = true;
        break;
      }
    }
    expect(finished).toBe(true);
  });

  it("catches multiple greens on the perfect-green-wave scenario when following the optimizer", () => {
    const sim = new DriveSimulator(demoCorridor, scenario, { mode: "optimized" });
    sim.setSpeedMultiplier(20);
    sim.play();
    let state = sim.getState();
    for (let i = 0; i < 1000 && !state.finished; i++) {
      state = sim.tick(250);
    }
    expect(state.metrics.greensCaught).toBeGreaterThanOrEqual(3);
  });

  it("runScenarioToCompletion produces coherent, non-negative metrics for both modes", () => {
    const optimized = runScenarioToCompletion(demoCorridor, scenario, "optimized");
    const baseline = runScenarioToCompletion(demoCorridor, scenario, "baseline");

    for (const metrics of [optimized, baseline]) {
      expect(metrics.tripTimeSec).toBeGreaterThan(0);
      expect(metrics.stops).toBeGreaterThanOrEqual(0);
      expect(metrics.greensCaught).toBeGreaterThanOrEqual(0);
      expect(metrics.greensCaught).toBeLessThanOrEqual(metrics.totalIntersections);
    }
  });

  it("on the perfect-green-wave scenario, the optimized strategy catches at least as many greens as baseline", () => {
    const optimized = runScenarioToCompletion(demoCorridor, scenario, "optimized");
    const baseline = runScenarioToCompletion(demoCorridor, scenario, "baseline");
    expect(optimized.greensCaught).toBeGreaterThanOrEqual(baseline.greensCaught);
  });

  it("reset() returns the simulator to the scenario's initial state", () => {
    const sim = new DriveSimulator(demoCorridor, scenario);
    sim.play();
    for (let i = 0; i < 20; i++) sim.tick(200);
    sim.reset(scenario);
    const state = sim.getState();
    expect(state.vehicle.positionM).toBe(scenario.startPositionM);
    expect(state.running).toBe(false);
    expect(state.metrics.stops).toBe(0);
  });
});
