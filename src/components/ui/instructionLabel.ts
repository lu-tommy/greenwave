import { roundMph } from "@/lib/geo/units";
import type { DriveInstruction } from "@/lib/types";

/**
 * Calm, non-gamified copy for each instruction. Never "GO!" / "BEAT THE
 * LIGHT!" — the tone should read like a premium OEM cluster, not a game.
 */
export function instructionLabel(instruction: DriveInstruction, targetSpeedMps: number): string {
  const mph = roundMph(targetSpeedMps);
  switch (instruction) {
    case "HOLD":
      return `HOLD ${mph} MPH`;
    case "COAST":
      return `COAST TO ${mph} MPH`;
    case "SLOW":
      return `SLOW TO ${mph} MPH`;
    case "ACCELERATE_GENTLY":
      return `EASE TO ${mph} MPH`;
    case "PREPARE_TO_STOP":
      return "PREPARE TO STOP";
    default:
      return `${mph} MPH`;
  }
}

export function instructionAccentClass(instruction: DriveInstruction): string {
  switch (instruction) {
    case "HOLD":
    case "ACCELERATE_GENTLY":
      return "text-accent-green";
    case "COAST":
      return "text-accent-blue";
    case "SLOW":
      return "text-accent-amber";
    case "PREPARE_TO_STOP":
      return "text-accent-red";
    default:
      return "text-foreground";
  }
}
