# Green Wave

A consumer-facing **Green Light Optimal Speed Advisory (GLOSA)** app: enter a destination, and Green Wave calculates the route, automatically finds the traffic signals along it, and recommends the legal, smooth speed most likely to catch a sequence of greens — clearly marking what it doesn't know yet, and learning from every drive.

> **Traffic signal LOCATIONS come from OpenStreetMap. Traffic signal TIMING does not.** Timing is either manually calibrated, learned from your own drive observations, or unavailable ("unknown"). Green Wave never fabricates a phase and never implies it has live SPaT data from any DOT. See [Signal timing — where it actually comes from](#signal-timing--where-it-actually-comes-from).

## The core question

> "What speed should I drive right now, within the speed limit, to pass through the upcoming traffic lights as smoothly as possible?"

The app answers this with guidance like `HOLD 21 MPH`, `COAST TO 16 MPH`, `SLOW TO 18 MPH`, or `PREPARE TO STOP` — never with urgent or gamified language ("beat the light"), and **never a speed above the posted limit**. When a signal's timing is unknown, it's shown as `?` / `UNKNOWN`, never as a guessed green or red.

## Two modes

- **Route Drive** (`/drive`) — **primary, real-world mode.** Enter a destination, Green Wave finds the route and the signals on it, and tracks you live via GPS. This is what you'd use on an actual drive.
- **Simulator** (`/simulator`) and **Corridor Drive** (`/drive/corridor`) — the original demo-corridor experience: a manually-defined, fictional corridor with simulated timing, useful for testing the engine and UI without a real route or GPS.

Both modes share one optimization engine — there is no separate "route" optimizer and "demo" optimizer.

## Try it

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`. The Simulator and Corridor Drive work immediately, no setup required. **Route Drive** (destination search + real routing + signal discovery) needs one environment variable — see [Setup: Mapbox token](#setup-mapbox-token) below. Without it, `/drive` shows a clear "routing unavailable" state and points you to the Simulator instead — it never crashes.

## Setup: Mapbox token

Route Drive uses [Mapbox](https://www.mapbox.com/) for destination search (Geocoding) and routing (Directions, `mapbox/driving-traffic`). The token is **server-only** — it never reaches the browser:

```bash
# .env.local
MAPBOX_TOKEN=pk.your_token_here
```

Get a free token at [account.mapbox.com](https://account.mapbox.com/) (the free tier is generous for personal use). All Mapbox calls go through this app's own API routes (`/api/routing/search`, `/api/routing/directions`), which hold the token server-side — see [API proxies](#api-proxies--cors).

Traffic-signal **location** discovery uses the public [Overpass API](https://overpass-api.de/) (OpenStreetMap) and needs no key, also proxied server-side (`/api/signals/discover`).

## Architecture

The optimization engine is plain TypeScript with **no dependency on React or the map** — it's designed to be reused by a native iPhone/CarPlay app, a backend service, or a different UI later. Route Drive is a pipeline that ends by producing a plain `Corridor`, so the existing engine needs zero changes to serve it:

```
Destination search
        │
        ▼
  RoutingProvider ──► Route (geometry, steps, distance/duration)
        │
        ▼
TrafficSignalDiscoveryProvider ──► DiscoveredSignal[] (locations only, from OSM)
        │
        ▼
SignalTimingProvider chain (manual → learned → unknown)
        │
        ▼
  buildRouteCorridor() ──► Corridor   ◄── (same shape as the demo corridor)
        │
        ▼
  optimize()  (the one, unmodified engine)
        │
        ▼
  DriveRecommendation
```

```
src/
  lib/
    types/            Shared domain model — Corridor, Route, DiscoveredSignal, SignalKnowledgeRecord, ...
    signals/           Deterministic signal-phase engine (phase is "unknown" when signalPlan is null)
      discovery/        OsmTrafficSignalDiscoveryProvider — turns OSM nodes into DiscoveredSignal[]
    optimizer/         Green-wave optimizer + kinematic arrival estimation (route-aware, unchanged core)
    simulation/        Clock-independent drive simulator
    routing/           RoutingProvider, MapboxRoutingProvider, route↔corridor adapter, route progress/caching
    learning/          Passive observation tracking + conservative timing inference
    driveSession/      DriveSessionRecorder — ties a drive's history, observations, and learning together
    geo/               Units, distance/projection, GPS speed smoothing
    providers/         SignalTimingProvider chain: Static (demo), Manual (calibrated), Learned, Chained
    data/corridors/    Demo corridor + scenario definitions (Simulator / Corridor Drive)
    storage/           localStorage (calibration, recents, route cache) + IndexedDB (signal knowledge, observations, sessions)
  components/
    ui/                Presentational pieces (RecommendationHero, GreenWaveDots, DebugPanel, ...)
    map/               MapLibre wrapper
    simulator/         Simulator controls, metrics, baseline-vs-green-wave comparison
    drive/             RouteDriveFlow (primary), DestinationSearch, RoutePreview, RouteDriveActive, DriveSummary,
                        plus the original DriveView (Corridor Drive) and its geolocation hook
    corridors/         Calibration editor + Real-World Signal Knowledge inspector
  app/
    api/routing/       Server-side Mapbox proxy (search, directions) — token never reaches the client
    api/signals/       Server-side Overpass proxy (signal discovery)
    /, /simulator, /drive, /drive/corridor, /calibration
```

The UI layer never contains optimization logic — it only calls `optimize()`, `getSignalPhaseAtTime()`, etc. and renders the result.

## The signal engine

`src/lib/signals/signalEngine.ts` models a signal's cycle as `green → yellow → red`, starting at `offsetSec` relative to epoch 0. Given any timestamp, `cyclePosition()` computes where in the cycle that instant falls using `(t - offset) mod cycle`, correct across cycle wraparound, negative/normalized offsets, and arbitrary future cycles. An intersection's `signalPlan` is `SignalPlan | null` — `null` means "no trustworthy timing model", and every engine function (`getSignalPhaseAtTime`, `predictSignalState`, `getGreenWindows`) returns an explicit `"unknown"` phase / `null` timing fields in that case, never a guess.

## The green-wave optimizer

`src/lib/optimizer/optimizer.ts` does a **discretized search** over candidate cruise speeds (0.5 mph steps, capped at the posted speed limit). For each candidate it:

1. Estimates arrival time at each upcoming intersection using a kinematic model (`src/lib/optimizer/kinematics.ts`) that accounts for the transition from current speed to the candidate speed, not just `distance / speed`.
2. Predicts the signal phase at each arrival using the signal engine — `"unknown"` for signals with no timing model, contributing neither reward nor penalty (it's excluded from green-wave counts and never triggers "prepare to stop").
3. Scores the candidate: rewarding consecutive greens caught and low travel time, penalizing stops, hard braking/acceleration, unnecessary speed variation, and yellow arrivals.

The **speed limit is a hard constraint**, not a scoring penalty — candidates are never generated above it, so no code path can ever recommend speeding, including to "catch" a green only reachable illegally, or a route with no timing data at all (see `optimizer.test.ts`'s "unknown signal timing safety" suite). Low-confidence or unknown downstream data makes the recommendation fall back toward the current legal cruising speed instead of asserting false precision — except at the very start of a drive (current speed ≈ 0, no established baseline yet), where it instead uses its best legal candidate rather than getting stuck recommending 0 mph forever. A smoothing pass (`smoothRecommendation`) snaps small same-instruction speed deltas back to the previous recommendation to prevent flicker.

## Route Drive: destination → route → signals → corridor

### Routing

`RoutingProvider` (`src/lib/types`) is `{ searchDestination, getRoute }`. `MapboxRoutingProvider` (`src/lib/routing/MapboxRoutingProvider.ts`) is the only implementation, and it never calls Mapbox directly — it calls this app's own `/api/routing/search` and `/api/routing/directions` routes, which hold `MAPBOX_TOKEN` server-side. `getRoute` requests `mapbox/driving-traffic` with full GeoJSON geometry and steps.

### Automatic signal discovery

`TrafficSignalDiscoveryProvider` is `{ getSignalsNearRoute(route) }`. `OsmTrafficSignalDiscoveryProvider` (`src/lib/signals/discovery/OsmTrafficSignalDiscoveryProvider.ts`):

1. Downsamples the route geometry to ~one point per 60m (capped at 400 points) and sends it to `/api/signals/discover`, which queries Overpass with a single `node(around:40m, <points>)[highway=traffic_signals]` — a query proportional to route *length*, not a bounding-box area.
2. Locally, for each candidate: projects it onto the route line to get distance-along-route, perpendicular offset, and route heading at that point (`projectOntoPolyline`). Anything more than 35m off the route line is rejected outright (almost certainly a different street).
3. Estimates a **direction-applicability confidence** from whatever OSM direction metadata exists (`direction` / `traffic_signals:direction`, numeric bearing or compass word, compared to route heading); with no metadata at all, confidence is a modest, capped proximity-based guess — never asserted as certain. Signals below 0.3 confidence are dropped from the corridor entirely (shown only in the debug panel).
4. Deduplicates OSM nodes that are obviously the same physical intersection (multiple crosswalk-arm nodes within 15m along the route).
5. Assigns each signal a **stable id** (`osm:node:<id>`) so it maps back to the same learned model on every future drive — never a transient array index.

### Route → Corridor

`buildRouteCorridor()` (`src/lib/routing/routeCorridor.ts`) resolves each discovered signal's timing via the provider chain and produces a plain `Corridor` — the same type the demo corridor uses. This is the seam: the optimizer, simulator, and every UI component below it have no idea whether a `Corridor` came from a route or from `src/lib/data/corridors`.

## Signal timing — where it actually comes from

`SignalTimingProvider` is `{ getSignalPlan(id), getSignalPrediction(id, timestamp) }`. `ChainedSignalTimingProvider` (`src/lib/providers/ChainedSignalTimingProvider.ts`) tries, in order:

1. **`ManualSignalTimingProvider`** — timing you've calibrated yourself for a real signal, via the Calibration page (reuses the same localStorage mechanism as the demo corridor, under a shared namespace so it survives across different routes that pass the same intersection).
2. **`LearnedSignalTimingProvider`** — timing inferred from your own drive observations (below).
3. **`StaticSignalTimingProvider`** — used for the demo corridor; also the fallback shape for anything pre-defined.
4. **Unknown** — if nothing in the chain knows the signal, `plan: null`. Never fabricated.

## Passive learning

While driving, `ObservationTracker` (`src/lib/learning/observationTracker.ts`) watches speed and position relative to each upcoming signal and emits compact events — no raw GPS trail is kept:

- `STOP_AT_SIGNAL` → `DEPART_SIGNAL` — a genuine stop-and-go (≥1s stopped, not just a slow-roll).
- `PASS_SIGNAL_WITHOUT_STOP` — drove through without ever slowing near the signal.
- `GREEN_START_MANUAL` / `RED_START_MANUAL` — an optional, large **TAP WHEN GREEN** button shown only when the *next* signal is unknown (never required; the app is fully usable without ever tapping it).

`inferTimingModel()` (`src/lib/learning/timingInference.ts`) is deliberately conservative:

- Needs **≥3 green-start anchors** (manual taps weighted highest, passive departs lower) and tests a range of plausible cycle lengths (30–150s) using circular statistics; a cycle is only accepted if the anchors cluster tightly around it (ties between harmonics resolved toward the *larger* candidate).
- Needs **≥2 observed stop→depart wait pairs** to estimate red duration. Green-start anchors *alone*, with no red-duration evidence, produce **no model** — a real, admitted "we don't know the split" beats a fabricated 90/30 guess. (Yellow duration is a fixed, documented 3s assumption — it can't be inferred from stop/depart events.)
- Confidence is capped below what a manually-verified plan can reach, and decays over 30 days of no new observations (`decayModelConfidence`) — a learned model is never treated as permanent.

Direction matters: a signal's learned model is tied to the approach it was observed from, since a physical intersection can behave differently for each direction of travel.

## Drive sessions & first-drive diagnostics

Before **START DRIVE**, the Route Preview screen checks Location, Routing, Route, Traffic signals, GPS, and Network, and explains what will and won't work rather than blocking — if most of the route's signals are unknown, it becomes a **Learning Drive** automatically (`START LEARNING DRIVE`), which still tracks progress, records observations, and improves next time.

`DriveSessionRecorder` (`src/lib/driveSession/DriveSessionRecorder.ts`) accumulates the drive's recommendation history (throttled to ~1 sample/sec, capped at 3000 entries), every observation, and — at the end — re-runs inference for every signal touched, persisting updated `SignalKnowledgeRecord`s to IndexedDB. The post-drive summary reports distance, signals encountered, stops, new observations, and how many timing models actually improved.

**Export Drive Debug JSON** (post-drive summary) downloads a structured file (`formatVersion`, session metadata, full recommendation history, raw observations, and the corridor's signal states at drive end) — enough to hand back for after-the-fact diagnosis without needing console logs captured live.

## Off-route detection & rerouting

`RouteDriveFlow` projects each GPS fix onto the current route line; 3 consecutive fixes more than 50m off it triggers an `OFF ROUTE` banner and a fresh `getRoute` + signal-discovery pass from the current position, replacing the active corridor. Learned signal knowledge is keyed by signal id, not by route, so it's preserved across a reroute. If rerouting itself fails (offline, upstream error), the last known route/corridor is kept rather than leaving the driver with nothing.

## GPS smoothing, map matching, and offline resilience

GPS speed is smoothed in `src/lib/geo/speedFilter.ts`: prefer the browser's reported speed when available; otherwise derive it from consecutive fixes. A single implausible jump (>4 m/s² implied acceleration) is rejected unless a second consecutive reading agrees with it (a real, sustained change, so the filter can't get permanently stuck). Route Drive currently projects GPS directly onto the already-fetched route geometry (no per-tick network calls) rather than using Mapbox Map Matching — this keeps guidance working offline once a route is loaded and avoids issuing an API request per GPS sample, at the cost of not correcting for GPS drift the way server-side map matching would. Route/signal-discovery network calls happen only at route creation and on a confirmed reroute — never on a normal GPS tick.

## Safety philosophy

1. Never recommend exceeding the posted speed limit — enforced structurally (candidate generation is capped at the limit), not just by scoring.
2. No "race the light" language, ever.
3. A green only reachable via excessive acceleration is de-prioritized by the optimizer's braking/acceleration penalties.
4. When no legal speed reaches the next known green, the app recommends coasting/slowing/stopping instead.
5. Unknown signal timing is shown as unknown — never as a guessed phase — and never drives a "prepare to stop".
6. Low GPS, timing, or direction-applicability confidence degrades the recommendation rather than asserting false precision.
7. An off-route vehicle stops receiving recommendations from the stale route immediately, not after the next network round-trip.
8. A persistent, unobtrusive disclaimer: *"Advisory only — obey traffic laws and roadway conditions."*

## API proxies & CORS

Mapbox and Overpass are both called from Next.js Route Handlers (`src/app/api/routing/*`, `src/app/api/signals/discover`), never directly from the browser: this keeps `MAPBOX_TOKEN` server-only, avoids CORS entirely, and gives one place to handle upstream errors/rate-limits (`501` when the token is missing, `502`/`503` for upstream failures — the client always gets a typed, catchable error, never a crash).

## PWA & mobile Safari

The app has a generated manifest + icons (`src/app/manifest.ts`, `icon.tsx`, `apple-icon.tsx`) and can be added to an iPhone home screen for a standalone, full-screen experience. `useWakeLock` requests `navigator.wakeLock` during active driving to keep the screen on, falling back silently where unsupported. Layout uses `100dvh` (not `100vh`) and `env(safe-area-inset-*)` padding to handle Safari's resizing address bar and the notch/home-indicator safe areas.

## Testing

```bash
npm test          # Vitest: 126 unit/integration tests
npm run test:e2e  # Playwright: 6 end-to-end flows, including a fully-mocked destination→route→drive→summary journey
npm run build     # production build + typecheck
npm run lint       # ESLint
```

External APIs never touch the automated tests: Vitest tests use `MockRoutingProvider`/`MockTrafficSignalDiscoveryProvider` (`src/lib/routing/mockProviders.ts`) and IndexedDB is polyfilled with `fake-indexeddb`; the Playwright journey test (`e2e/route-drive-journey.spec.ts`) intercepts `/api/routing/*` and `/api/signals/discover` at the network layer and drives simulated GPS via `context.setGeolocation()` through the real app UI, end to end — destination search, route preview with known/learning signal counts, active drive, arrival, post-drive summary, and debug JSON export — with no Mapbox token or network access required.

Notable safety tests: a signal coordinated for ~21 mph is correctly caught by the optimizer on the demo corridor; a green reachable *only* at an illegal speed is never recommended, on any cycle, even a later one; an unknown signal never registers as "green" and never triggers "prepare to stop"; the first GPS fix of a drive (speed 0) doesn't get the recommendation stuck at 0 mph; a wrong-direction/low-confidence OSM signal is excluded from the corridor entirely.

## Limitations

- Route Drive needs a Mapbox token (free tier) to do anything beyond the "routing unavailable" state — Simulator and Corridor Drive work with zero setup.
- Direction-applicability confidence for a discovered signal is a heuristic (OSM tagging for signal direction is inconsistent) — it can exclude a genuinely-relevant signal or include a marginal one; the debug panel (Calibration → Real-World Signal Knowledge) is where you'd notice and correct that.
- Timing inference needs real evidence (stop/depart pairs or manual taps) — most signals on a first drive will be `UNKNOWN`, by design; it takes repeat drives to build usable models.
- No per-step speed limits from the routing provider are used yet (one conservative corridor-wide limit); no time-of-day timing profiles yet (a model is a single snapshot, though it does decay with staleness).
- Map matching is local geometric projection onto the fetched route, not Mapbox's server-side map-matching service.
- Free Drive (no destination, predict the path as you go) is an intentional non-goal for this pass — `FreeDriveRoutePredictor` is a named extension point, not implemented.
- No accounts, crowdsourcing backend, computer vision, or native app yet — by design (see Roadmap).

## Roadmap

- `FreeDriveRoutePredictor` — turn-by-turn-free guidance once destination mode is proven out.
- Crowdsourced signal timing (aggregate observations across users) and official SPaT/MAP integration where cities publish it.
- Time-of-day timing profiles instead of one snapshot model per signal.
- Native iPhone app + CarPlay, reusing the same `src/lib` engine (it has zero React/DOM dependencies).
- Per-step speed limits and Mapbox Map Matching for higher-fidelity route projection.

---

*Advisory only — obey traffic laws and roadway conditions.*
