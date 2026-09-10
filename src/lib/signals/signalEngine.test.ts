import { describe, expect, it } from "vitest";
import {
  cyclePosition,
  getGreenWindows,
  getNextPhaseTransition,
  getSignalPhaseAtTime,
  predictSignalState,
} from "./signalEngine";
import type { Intersection, SignalPlan } from "@/lib/types";

// Cycle = 90s: green 40s, yellow 4s, red 46s, offset 15s.
const plan: SignalPlan = {
  cycleSec: 90,
  greenSec: 40,
  yellowSec: 4,
  redSec: 46,
  offsetSec: 15,
};

const EPOCH0 = Date.UTC(2026, 0, 1, 0, 0, 0); // arbitrary reference wall-clock instant

function atSec(offsetFromEpoch0: number) {
  return EPOCH0 + offsetFromEpoch0 * 1000;
}

describe("getSignalPhaseAtTime", () => {
  it("is green at the exact start of the green phase (t = offset)", () => {
    expect(getSignalPhaseAtTime(plan, atSec(15))).toBe("green");
  });

  it("is green just before the end of green", () => {
    expect(getSignalPhaseAtTime(plan, atSec(15 + 40 - 0.5))).toBe("green");
  });

  it("transitions to yellow at green end", () => {
    expect(getSignalPhaseAtTime(plan, atSec(15 + 40))).toBe("yellow");
  });

  it("is yellow just before yellow ends", () => {
    expect(getSignalPhaseAtTime(plan, atSec(15 + 40 + 4 - 0.5))).toBe("yellow");
  });

  it("transitions to red at yellow end", () => {
    expect(getSignalPhaseAtTime(plan, atSec(15 + 44))).toBe("red");
  });

  it("is red just before wraparound", () => {
    expect(getSignalPhaseAtTime(plan, atSec(15 + 90 - 0.5))).toBe("red");
  });

  it("wraps around from red back to green at the next cycle", () => {
    expect(getSignalPhaseAtTime(plan, atSec(15 + 90))).toBe("green");
  });

  it("handles multiple future cycles identically to the base cycle", () => {
    const base = getSignalPhaseAtTime(plan, atSec(20));
    const fiveCyclesLater = getSignalPhaseAtTime(plan, atSec(20 + 90 * 5));
    expect(fiveCyclesLater).toBe(base);
  });

  it("handles timestamps before epoch0 (negative relative time) consistently", () => {
    expect(getSignalPhaseAtTime(plan, atSec(15 - 90))).toBe("green");
  });

  it("handles a zero offset", () => {
    const zeroOffsetPlan: SignalPlan = { ...plan, offsetSec: 0 };
    expect(getSignalPhaseAtTime(zeroOffsetPlan, atSec(0))).toBe("green");
    expect(getSignalPhaseAtTime(zeroOffsetPlan, atSec(39.9))).toBe("green");
    expect(getSignalPhaseAtTime(zeroOffsetPlan, atSec(40))).toBe("yellow");
  });

  it("handles a negative offset by normalizing it", () => {
    const negOffsetPlan: SignalPlan = { ...plan, offsetSec: -75 }; // equivalent to +15 on a 90s cycle
    expect(getSignalPhaseAtTime(negOffsetPlan, atSec(15))).toBe("green");
  });

  it("throws for an inconsistent plan (durations don't sum to cycle)", () => {
    const bad: SignalPlan = { cycleSec: 90, greenSec: 40, yellowSec: 4, redSec: 40, offsetSec: 0 };
    expect(() => getSignalPhaseAtTime(bad, atSec(0))).toThrow();
  });
});

describe("cyclePosition", () => {
  it("is always within [0, cycleSec)", () => {
    for (let t = -500; t < 500; t += 7) {
      const pos = cyclePosition(plan, atSec(t));
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos).toBeLessThan(plan.cycleSec);
    }
  });
});

describe("getNextPhaseTransition", () => {
  it("returns the green->yellow boundary when currently in green", () => {
    const t = atSec(20);
    const next = getNextPhaseTransition(plan, t);
    expect(next).toBe(atSec(15 + 40));
  });

  it("returns the yellow->red boundary when currently in yellow", () => {
    const t = atSec(15 + 41);
    const next = getNextPhaseTransition(plan, t);
    expect(next).toBe(atSec(15 + 44));
  });

  it("returns the red->green (wraparound) boundary when currently in red", () => {
    const t = atSec(15 + 50);
    const next = getNextPhaseTransition(plan, t);
    expect(next).toBe(atSec(15 + 90));
  });

  it("returns the following cycle's boundary, not the current instant, when queried exactly at a boundary", () => {
    const t = atSec(15); // exactly the start of green
    const next = getNextPhaseTransition(plan, t);
    expect(next).toBe(atSec(15 + 40));
  });
});

describe("predictSignalState", () => {
  const intersection: Intersection = {
    id: "int-1",
    name: "Test & Main",
    lat: 0,
    lng: 0,
    distanceAlongCorridorM: 0,
    signalPlan: plan,
    confidence: 0.9,
  };

  it("reports nextGreenAt === arrival time when already green", () => {
    const t = atSec(20);
    const pred = predictSignalState(intersection, t);
    expect(pred.phase).toBe("green");
    expect(pred.nextGreenAt).toBe(t);
    expect(pred.nextGreenEndsAt).toBe(atSec(15 + 40));
  });

  it("reports the correct next green window when arriving during red", () => {
    const t = atSec(15 + 50); // 5s into red
    const pred = predictSignalState(intersection, t);
    expect(pred.phase).toBe("red");
    expect(pred.nextGreenAt).toBe(atSec(15 + 90));
    expect(pred.nextGreenEndsAt).toBe(atSec(15 + 90 + 40));
  });

  it("reports the correct next green window when arriving during yellow", () => {
    const t = atSec(15 + 41);
    const pred = predictSignalState(intersection, t);
    expect(pred.phase).toBe("yellow");
    expect(pred.nextGreenAt).toBe(atSec(15 + 90));
  });

  it("carries the intersection's confidence through", () => {
    const pred = predictSignalState(intersection, atSec(20));
    expect(pred.confidence).toBe(0.9);
  });
});

describe("getGreenWindows", () => {
  it("includes the currently active window, clamped to startTime, when starting during green", () => {
    const start = atSec(20); // 5s into the green window that starts at atSec(15)
    const windows = getGreenWindows(plan, start, 30);
    expect(windows[0].startAt).toBe(start);
    expect(windows[0].endAt).toBe(atSec(15 + 40));
  });

  it("finds only the current window within a short horizon", () => {
    const start = atSec(20);
    const windows = getGreenWindows(plan, start, 10);
    expect(windows).toHaveLength(1);
  });

  it("finds multiple future windows across a longer horizon", () => {
    const start = atSec(0);
    const windows = getGreenWindows(plan, start, 300); // ~3.3 cycles
    expect(windows.length).toBeGreaterThanOrEqual(3);
    // Each window should be exactly one cycle apart (after the first).
    for (let i = 2; i < windows.length; i++) {
      expect(windows[i].startAt - windows[i - 1].startAt).toBe(plan.cycleSec * 1000);
    }
  });

  it("does not include a window when starting mid-red with a horizon shorter than time-to-green", () => {
    const start = atSec(15 + 50); // 5s into a 46s red
    const windows = getGreenWindows(plan, start, 10);
    expect(windows).toHaveLength(0);
  });

  it("every returned window has endAt - startAt <= greenSec", () => {
    const start = atSec(0);
    const windows = getGreenWindows(plan, start, 500);
    for (const w of windows) {
      expect(w.endAt - w.startAt).toBeLessThanOrEqual(plan.greenSec * 1000 + 1);
    }
  });
});

describe("unknown (null) signal plans — must never be treated as green", () => {
  it("getSignalPhaseAtTime returns 'unknown' for a null plan", () => {
    expect(getSignalPhaseAtTime(null, atSec(20))).toBe("unknown");
  });

  it("getNextPhaseTransition returns null for a null plan", () => {
    expect(getNextPhaseTransition(null, atSec(20))).toBeNull();
  });

  it("getGreenWindows returns an empty array for a null plan", () => {
    expect(getGreenWindows(null, atSec(0), 300)).toEqual([]);
  });

  it("predictSignalState returns phase 'unknown' with all timing fields null for a null plan", () => {
    const intersection: Intersection = {
      id: "int-unknown",
      name: "Unknown Signal",
      lat: 0,
      lng: 0,
      distanceAlongCorridorM: 0,
      signalPlan: null,
      confidence: 0,
    };
    const pred = predictSignalState(intersection, atSec(20));
    expect(pred.phase).toBe("unknown");
    expect(pred.secondsRemainingInPhase).toBeNull();
    expect(pred.nextTransitionAt).toBeNull();
    expect(pred.nextGreenAt).toBeNull();
    expect(pred.nextGreenEndsAt).toBeNull();
  });
});
