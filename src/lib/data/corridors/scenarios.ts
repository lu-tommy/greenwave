import { mphToMps } from "@/lib/geo/units";
import type { SimulationScenario } from "@/lib/types";
import { REFERENCE_TIMESTAMP, demoCorridor, DEMO_PROGRESSION_SPEED_MPS } from "./demoCorridor";

export const simulationScenarios: SimulationScenario[] = [
  {
    id: "perfect-green-wave",
    name: "Perfect Green Wave",
    description:
      "Enter the corridor right on the coordinated progression speed. A steady legal speed should catch several consecutive greens.",
    corridorId: demoCorridor.id,
    startPositionM: 0,
    startSpeedMps: DEMO_PROGRESSION_SPEED_MPS,
    startTimestamp: REFERENCE_TIMESTAMP,
  },
  {
    id: "missed-window",
    name: "Missed Window",
    description:
      "Enter the corridor 18 seconds behind the coordinated wave. The first light can no longer be caught cleanly — the app should recommend easing off rather than rushing it.",
    corridorId: demoCorridor.id,
    startPositionM: 0,
    startSpeedMps: DEMO_PROGRESSION_SPEED_MPS,
    startTimestamp: REFERENCE_TIMESTAMP + 18_000,
  },
  {
    id: "too-fast",
    name: "Too Fast",
    description:
      "Start at the posted speed limit, above the ~21 mph progression speed. The app should calmly bring the target down instead of letting the driver run up on reds.",
    corridorId: demoCorridor.id,
    startPositionM: 0,
    startSpeedMps: mphToMps(25),
    startTimestamp: REFERENCE_TIMESTAMP,
  },
  {
    id: "stop-required",
    name: "Stop Required",
    description:
      "Begin already inside the uncoordinated back half of the corridor, where no legal speed produces a clean green. The app should recommend preparing to stop rather than racing the light.",
    corridorId: demoCorridor.id,
    startPositionM: 2500,
    startSpeedMps: DEMO_PROGRESSION_SPEED_MPS,
    startTimestamp: REFERENCE_TIMESTAMP,
  },
  {
    id: "timing-uncertain",
    name: "Timing Uncertain",
    description:
      "Approach a signal with stale, low-confidence calibration data. The recommendation should become more conservative rather than asserting false precision.",
    corridorId: demoCorridor.id,
    startPositionM: 3200,
    startSpeedMps: DEMO_PROGRESSION_SPEED_MPS,
    startTimestamp: REFERENCE_TIMESTAMP,
  },
];

export function getScenario(id: string): SimulationScenario | undefined {
  return simulationScenarios.find((s) => s.id === id);
}
