# Green Wave

A consumer-facing **Green Light Optimal Speed Advisory (GLOSA)** concept: it predicts the phase of upcoming traffic signals along a corridor and recommends the legal speed most likely to catch a sequence of green lights, smoothly.

> **V1 uses simulated / manually-calibrated signal timing.** This app does not connect to live traffic signal controllers, NYC DOT SPaT feeds, or any official signal timing source. See [Limitations](#limitations).

## The core question

> "What speed should I drive right now, within the speed limit, to pass through the upcoming traffic lights as smoothly as possible?"

The app answers this with guidance like `HOLD 21 MPH`, `COAST TO 16 MPH`, `SLOW TO 18 MPH`, or `PREPARE TO STOP` — never with urgent or gamified language ("beat the light"), and **never a speed above the posted limit**.

## Why it exists

Stop-and-go driving through uncoordinated intersections wastes time, fuel, and brake pads, and it's stressful. Cities coordinate some signal timing already (real "green waves"), but drivers have no way to know the target progression speed. This project explores what a legal, calm, portfolio-quality advisory tool for that problem could look like — engine first, decoration second.

## Try it

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`:

- **Simulator** (`/simulator`) — pick a scenario, press Play, and watch a virtual vehicle drive the demo corridor. Compare a normal drive against the green-wave-optimized drive.
- **Drive Mode** (`/drive`) — grants browser geolocation and gives you the same guidance in real time as you approach the (real-world) location of the demo corridor.
- **Calibration** (`/calibration`) — inspect/edit the manually-defined signal timing behind the demo corridor.

No environment variables are required. The map uses free, key-free OpenStreetMap raster tiles via MapLibre GL; if tiles fail to load (offline, blocked), the app falls back to a plain panel and the optimizer/simulator keep working normally — the map is a visualization layer, never a dependency of the core logic.

## Architecture

The optimization engine is plain TypeScript with **no dependency on React or the map** — it's designed to be reused by a native iPhone/CarPlay app, a backend service, or a different UI later.

```
src/
  lib/
    types/        Shared domain model (Corridor, Intersection, SignalPlan, DriveRecommendation, ...)
    signals/       Deterministic signal-phase engine
    optimizer/     Green-wave optimizer + kinematic arrival estimation
    simulation/    Clock-independent drive simulator
    geo/           Units, distance/projection, GPS speed smoothing
    providers/     SignalTimingProvider abstraction (see below)
    data/corridors/  Demo corridor + scenario definitions
    storage/       localStorage-backed calibration overrides
  components/
    ui/            Presentational pieces (RecommendationHero, GreenWaveDots, DebugPanel, ...)
    map/           MapLibre wrapper
    simulator/      Simulator controls, metrics, baseline-vs-green-wave comparison
    drive/          Geolocation hook + Drive Mode view
    corridors/      Calibration editor
  app/             Next.js App Router pages (/, /simulator, /drive, /calibration)
```

The UI layer never contains optimization logic — it only calls `optimize()`, `getSignalPhaseAtTime()`, etc. and renders the result.

## The signal engine

`src/lib/signals/signalEngine.ts` models a signal's cycle as `green → yellow → red`, starting at `offsetSec` relative to epoch 0. Given any timestamp, `cyclePosition()` computes where in the cycle that instant falls using `(t - offset) mod cycle`, which is correct across cycle wraparound, negative/normalized offsets, and arbitrary future cycles. `getSignalPhaseAtTime`, `getNextPhaseTransition`, `getGreenWindows`, and `predictSignalState` are all built on this. It has 20+ unit tests covering boundary conditions (start/end of each phase, wraparound, multiple future cycles, positive/negative offsets).

## The green-wave optimizer

`src/lib/optimizer/optimizer.ts` does a **discretized search** over candidate cruise speeds (0.5 mph steps, capped at the posted speed limit). For each candidate it:

1. Estimates arrival time at each upcoming intersection using a kinematic model (`src/lib/optimizer/kinematics.ts`) that accounts for the transition from current speed to the candidate speed, not just `distance / speed`.
2. Predicts the signal phase at each arrival using the signal engine.
3. Scores the candidate: rewarding consecutive greens caught and low travel time, penalizing stops, hard braking/acceleration, unnecessary speed variation, and yellow arrivals.

The **speed limit is a hard constraint**, not a scoring penalty — candidates are never generated above it, so no code path can ever recommend speeding, including to "catch" a green that's only reachable illegally (see `optimizer.test.ts`). The optimizer also considers **multiple downstream intersections** (not just the next one), and low-confidence downstream data makes the recommendation more conservative rather than asserting false precision. A smoothing pass (`smoothRecommendation`) snaps small same-instruction speed deltas back to the previous recommendation to prevent flicker.

## Simulator

`src/lib/simulation/simulator.ts` is a `DriveSimulator` class with its own clock — `tick(dtRealMs)` advances simulated time by `dtRealMs * speedMultiplier`, completely independent of `Date.now()`. This is what lets the simulator run at 10x speed and still compute signal phases correctly. `runScenarioToCompletion()` runs a scenario headlessly (no rendering) for the baseline-vs-green-wave comparison feature — both drives use the identical corridor and timing model, and the comparison shows real, unmodified metrics (if the optimized strategy doesn't win in a given scenario, that's shown honestly).

## GPS Drive Mode

`src/components/drive/useGeolocationDrive.ts` watches `navigator.geolocation`, projects the fix onto the selected corridor's polyline (`projectOntoPolyline`), and feeds the result into the same `optimize()` function the simulator uses. If the driver is too far from the corridor or heading the wrong way, the UI shows a clear degraded state instead of a fabricated recommendation.

GPS speed is smoothed in `src/lib/geo/speedFilter.ts`: prefer the browser's reported speed when available; otherwise derive it from consecutive fixes. A single implausible jump (>4 m/s² implied acceleration) is rejected unless a second consecutive reading agrees with it (treated as a real, sustained change so the filter can't get stuck). Accepted readings feed a rolling median (last 5) then an EMA, so one bad GPS sample can't cause a large recommendation swing.

## Safety philosophy

1. Never recommend exceeding the posted speed limit — enforced structurally (candidate generation is capped at the limit), not just by scoring.
2. No "race the light" language, ever.
3. A green only reachable via excessive acceleration is effectively de-prioritized by the optimizer's braking/acceleration penalties.
4. When no legal speed reaches the next green, the app recommends coasting/slowing/stopping instead.
5. Low GPS or timing confidence degrades the recommendation rather than asserting false precision.
6. A persistent, unobtrusive disclaimer: *"Advisory only — obey traffic laws and roadway conditions."*

## Signal timing data — the real limitation

The hardest real-world problem for a system like this is **getting accurate live signal timing**. V1 does not solve this — it's architected around it. `SignalTimingProvider` (`src/lib/types/index.ts`) is the interface every timing source implements:

```ts
interface SignalTimingProvider {
  getSignalPrediction(intersectionId: string, timestamp: number): Promise<SignalPrediction>;
}
```

`StaticSignalTimingProvider` (`src/lib/providers/StaticSignalTimingProvider.ts`) is the only implementation shipped — it serves predictions from the manually-calibrated demo corridor. Future implementations (not built, intentionally):

- `LearnedSignalTimingProvider` — infer timing from repeated observed crossings.
- `CrowdsourcedSignalTimingProvider` — aggregate observations across users.
- `SpatSignalTimingProvider` — consume an official SPaT/MAP feed where available.

None of these exist yet, and the app makes no claim of connecting to real signal infrastructure anywhere in its UI or code.

## Testing

```bash
npm test          # Vitest: 66 unit/integration tests (signal engine, optimizer, simulator, geo, GPS filter)
npm run test:e2e  # Playwright: 3 critical end-to-end flows (simulator play+compare, drive mode GPS-denied fallback, calibration validation)
npm run build     # production build + typecheck
npm run lint       # ESLint
```

Notable test scenarios: a signal coordinated for ~21 mph is correctly identified and caught by the optimizer on the demo corridor; a green reachable *only* at an illegal speed is never recommended, on any cycle; a vehicle approaching an unavoidable red is told to slow down rather than hold speed into it.

## Limitations

- One demo corridor with fictional timing data (`SIMULATED SIGNAL DATA`), not real DOT signal plans.
- Corridor matching in Drive Mode is manual selection + polyline projection, not general-purpose map matching or routing.
- The kinematic model is a simple constant-acceleration approximation — no road grade, curvature, or other traffic.
- No accounts, crowdsourcing backend, computer vision, or native app yet — by design for V1 (see Roadmap).

## Roadmap

- Learned/crowdsourced signal timing providers (the biggest real unlock).
- Official SPaT/MAP integration where cities publish it.
- Native iPhone app + CarPlay, reusing the same `src/lib` engine (it has zero React/DOM dependencies).
- General routing/map-matching instead of manual corridor selection.
- Multi-corridor, city-scale coverage.

---

*Advisory only — obey traffic laws and roadway conditions.*
