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

## Getting started

### Prerequisites

- **Node.js 20.9 or newer** (built and tested on 22.x — an `.nvmrc` is included, so `nvm use` picks the right version automatically). Check with `node --version`; on macOS, [nvm](https://github.com/nvm-sh/nvm) or `brew install node` both work fine.
- npm (ships with Node — no separate install).
- That's it. No database, no Docker, no paid accounts.

### Clone, install, run

```bash
git clone https://github.com/lu-tommy/greenwave.git
cd greenwave
npm install
npm run dev
```

Open `http://localhost:3000`. **Everything works immediately — no API keys, no accounts, and no credit card, anywhere.** Route Drive's destination search, routing, and signal discovery all run on free, open-source, key-free public services (OSRM, Nominatim, Overpass), proxied through this app's own server routes. See [Setup: routing services](#setup-routing-services) below if you ever want to point at your own self-hosted instances instead — entirely optional.

### Running the tests

```bash
npm test                         # Vitest — 126 unit/integration tests, no setup needed
npx playwright install chromium  # one-time browser download, needed before e2e tests
npm run test:e2e                 # Playwright — 6 end-to-end flows (all network-mocked)
npm run build                    # production build + typecheck
npm run lint                     # ESLint
```

All of the above run identically on macOS, Linux, and Windows — nothing in this repo is OS-specific.

### Testing Route Drive on your phone

The GPS features (Route Drive, Corridor Drive) need a secure (HTTPS) origin and an actual device — `localhost` in a desktop browser can't give you real GPS movement. To try it on your phone while `npm run dev` is running on your computer, tunnel port 3000 over HTTPS:

- **Tailscale** (if you already use it): `tailscale serve https / http://localhost:3000`, then open the printed `https://<machine>.<tailnet>.ts.net` URL on your phone (same tailnet, Tailscale app installed there too).
- **ngrok**: `ngrok http 3000`, then open the HTTPS URL it prints, from any device.

On your phone: open that URL → **Drive Mode** → allow location → enter a destination → **START DRIVE**.

## Setup: routing services

Route Drive uses three open, key-free public services, each called through this app's own server-side API routes (never directly from the browser):

| Purpose | Service | Env var (optional override) |
|---|---|---|
| Destination search (geocoding) | [Nominatim](https://nominatim.openstreetmap.org) | `NOMINATIM_BASE_URL` |
| Routing (directions) | [OSRM](https://router.project-osrm.org) demo server | `OSRM_BASE_URL` |
| Traffic signal locations | [Overpass API](https://overpass-api.de) | `OVERPASS_BASE_URL` |

None of these need a token, sign-up, or payment method — the app works exactly as cloned. The env vars above are **entirely optional**: they only matter if you outgrow the public demo servers' fair-use limits (they're shared community resources meant for light/personal use, not high-volume production traffic) and want to point at a self-hosted instance instead. Same request shape, drop-in replacement.

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
    routing/           RoutingProvider, OsrmRoutingProvider, route↔corridor adapter, route progress/caching
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
    api/routing/       Server-side proxy to Nominatim (search) and OSRM (directions) — both free, key-free
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

`RoutingProvider` (`src/lib/types`) is `{ searchDestination, getRoute }`. `OsrmRoutingProvider` (`src/lib/routing/OsrmRoutingProvider.ts`) is the only implementation, and it never calls Nominatim/OSRM directly from the browser — it calls this app's own `/api/routing/search` and `/api/routing/directions` routes, which proxy to the public services server-side (adding the descriptive `User-Agent` both ask fair-use clients to send). `getRoute` requests full GeoJSON geometry and turn-by-turn steps from OSRM's `driving` profile.

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

## Signal Intelligence Layer

Everything above (`SignalTimingProvider`, `Corridor.signalPlan`) still runs unchanged — it's what the optimizer, simulator, and drive-corridor UI use. Layered on top, `src/lib/signalIntelligence/` normalizes evidence from *any* source (manual, learned, a real SPaT feed) into one shape and adds the safety/confidence machinery a route-drive advisory needs before it can say something as strong as "N seconds to green." Studied (never copied) from how products like Audi's Personal Signal Assistant, Connected Signals/EnLighten, and USDOT's SAE J2735 SPaT/MAP standard frame the same problem — see `docs/spat-compatibility.md` for the exact mapping and `docs/nyc-signal-data-research.md` for what real data sources were investigated (bottom line: none are both live and openly usable today, and the architecture is built around that being normal, not a gap to hide).

**Normalized model** (`src/lib/types/signalIntelligence.ts`): a `SignalTimingEvidence` record — `source` (`MANUAL` / `LEARNED` / `OFFICIAL_LIVE` / `OFFICIAL_STATIC` / `HISTORICAL` / `EXTERNAL_LIVE`), `phase`, a `minEndTime`/`likelyEndTime`/`maxEndTime` window (not a single point — a deterministic legacy plan collapses all three, a real SPaT message can carry genuine uncertainty), `confidence`, and `observedAt`. A `SignalApproach` (`signalId` + `maneuver`: `THROUGH`/`LEFT`/`RIGHT`/`U_TURN`) replaces "the signal" with "the specific movement through it a route actually takes" — `approachResolver.ts` derives this from the route's own turn-by-turn maneuvers, falling back to THROUGH only where there's no turn evidence.

**Fusion** (`SignalIntelligenceEngine.ts`): for each approach, every registered `SignalIntelligenceProvider` is asked for its evidence; the freshest-and-highest-confidence one wins, with a documented, non-blind precedence (source rank as a tiebreaker only within a small confidence margin — never silently overriding a fresher/better source). Confidence is bucketed into three tiers (`confidence.ts`): **HIGH** (≥0.95, precise countdowns allowed), **ESTIMATED** (0.80–0.95, ranges only), **UNAVAILABLE** (<0.80, no precise claim at all). Each source also has its own freshness/hard-expiry policy — a live feed's message that's gone stale is dropped from fusion entirely rather than kept as an aging "best guess."

**Time-to-Green** (`timeToGreen.ts`, `TimeToGreenDisplay.tsx`): the "stopped at a trustworthy red" product behavior — a big countdown at HIGH confidence, a range at ESTIMATED, nothing invented at UNAVAILABLE. It has one hard rule regardless of tier: once the predicted transition is within 5 seconds, the UI switches to **WATCH SIGNAL** and never counts down to 0 or implies "go" — only the actual signal decides that. `RouteDriveActive` shows this instead of the normal GLOSA speed hero exactly when it's both trustworthy and relevant (`RouteDriveFlow`'s two-state MOVING/STOPPED reorientation).

**Probabilistic GLOSA** (`glosaUncertainty.ts`): arrival time carries its own uncertainty (from current speed/GPS accuracy), so "will I make the green" becomes an overlap between an arrival-time±uncertainty interval and the green window, bucketed into `DEFINITELY_GREEN` … `DEFINITELY_RED`, not a brittle point-in-time check. `robustGreenScore()` feeds the optimizer's scoring as an additive, optional term (`optimizer.ts`'s `signalEstimates` parameter) — entirely backward-compatible: omit it and behavior is identical to before this layer existed. Green Wave's own "how many greens in a row" metric now also requires each one to be at least ESTIMATED-confidence, and reports the actual **distance** of the run, not just a count.

**Live SPaT ingestion & replay** (`spatIngestion.ts`): a real feed's already-decoded SPaT messages (see `docs/spat-compatibility.md` for the exact JSON contract and what's deliberately not modeled — MAP messages, ASN.1 binary decoding, pedestrian phases) can be pushed into an in-memory `SpatMessageStore` and served through the same fusion engine as everything else. There is deliberately **no public write HTTP endpoint** for this — an unauthenticated write path has no place in production; today only tests and `spatReplay.test.ts`'s simulated-clock fixtures call `ingest()` directly, proving the whole ingest → fuse → Time-to-Green → GLOSA → freshness pipeline end to end without needing a live feed to exist. A turn movement (LEFT/RIGHT/U_TURN) with no matching SPaT signal group for it returns *no evidence* — it never silently borrows a THROUGH group's timing.

**Learning evolution** (`timingInference.ts`): `classifyControlType()` distinguishes a fixed/coordinated signal (green-start anchors line up tightly on one cycle) from a likely-actuated one (they don't), stored on `SignalKnowledgeRecord` for future display/weighting. `resynchronize()` lets a single fresh **TAP WHEN GREEN** re-anchor an existing learned model's phase offset immediately, without waiting to relearn the whole cycle — a manual tap is trusted more than a slow-decaying passive average.

**Staying fresh during a drive**: Manual/Learned evidence barely changes minute to minute, but the *absolute-timestamp* green window it implies for a cyclic signal is only valid at the instant it's computed — a route built at t=0 and driven for several minutes needs that window re-evaluated against the real clock, not the build-time snapshot. `RouteDriveFlow` re-fuses Signal Intelligence every 2 seconds during an active drive (cheap: Manual is sync localStorage, Learned is a handful of IndexedDB reads, done on a timer — never added to the per-GPS-tick hot path) and pushes a fresh Time-to-Green computation immediately after, so the display stays correct even between sparse GPS fixes (e.g. stopped at a red light).

**Hard safety invariants** (`safetyInvariants.test.ts`, one test per numbered rule, meant to be read top-to-bottom as an audit checklist): the speed limit is never exceeded regardless of signal data; no precise countdown below HIGH confidence; stale live data is dropped, never kept as authoritative; an unknown signal is never "green" or "red"; a turn movement never borrows THROUGH timing; low approach-applicability confidence excludes a signal from precise advice entirely; no "GO"/urgent language anywhere; the display never counts to 0; all guidance stays advisory.

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

GPS speed is smoothed in `src/lib/geo/speedFilter.ts`: prefer the browser's reported speed when available; otherwise derive it from consecutive fixes. A single implausible jump (>4 m/s² implied acceleration) is rejected unless a second consecutive reading agrees with it (a real, sustained change, so the filter can't get permanently stuck). Route Drive currently projects GPS directly onto the already-fetched route geometry (no per-tick network calls) rather than using a server-side map-matching service — this keeps guidance working offline once a route is loaded and avoids issuing an API request per GPS sample, at the cost of not correcting for GPS drift the way server-side map matching would. Route/signal-discovery network calls happen only at route creation and on a confirmed reroute — never on a normal GPS tick.

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

Nominatim, OSRM, and Overpass are all called from Next.js Route Handlers (`src/app/api/routing/*`, `src/app/api/signals/discover`), never directly from the browser: this avoids CORS entirely, lets each request carry the descriptive `User-Agent` these public services' fair-use policies ask for, and gives one place to handle upstream errors/rate-limits (`502`/`503` for upstream failures — the client always gets a typed, catchable error, never a crash).

## PWA & mobile Safari

The app has a generated manifest + icons (`src/app/manifest.ts`, `icon.tsx`, `apple-icon.tsx`) and can be added to an iPhone home screen for a standalone, full-screen experience. `useWakeLock` requests `navigator.wakeLock` during active driving to keep the screen on, falling back silently where unsupported. Layout uses `100dvh` (not `100vh`) and `env(safe-area-inset-*)` padding to handle Safari's resizing address bar and the notch/home-indicator safe areas.

## Testing

```bash
npm test          # Vitest: 220 unit/integration tests
npm run test:e2e  # Playwright: 6 end-to-end flows, including a fully-mocked destination→route→drive→summary journey
npm run build     # production build + typecheck
npm run lint       # ESLint
```

External APIs never touch the automated tests: Vitest tests use `MockRoutingProvider`/`MockTrafficSignalDiscoveryProvider` (`src/lib/routing/mockProviders.ts`) and IndexedDB is polyfilled with `fake-indexeddb`; the Playwright journey test (`e2e/route-drive-journey.spec.ts`) intercepts `/api/routing/*` and `/api/signals/discover` at the network layer and drives simulated GPS via `context.setGeolocation()` through the real app UI, end to end — destination search, route preview with known/learning signal counts, active drive, arrival, post-drive summary, and debug JSON export — with no API keys or network access required.

Notable safety tests: a signal coordinated for ~21 mph is correctly caught by the optimizer on the demo corridor; a green reachable *only* at an illegal speed is never recommended, on any cycle, even a later one; an unknown signal never registers as "green" and never triggers "prepare to stop"; the first GPS fix of a drive (speed 0) doesn't get the recommendation stuck at 0 mph; a wrong-direction/low-confidence OSM signal is excluded from the corridor entirely.

## Limitations

- Route Drive's routing/search/discovery run on public demo servers meant for light use — under heavy or sustained traffic they may rate-limit (the app surfaces this as a clear "try again shortly" state, never a crash); self-host OSRM/Nominatim/Overpass for anything beyond personal use.
- Direction-applicability confidence for a discovered signal is a heuristic (OSM tagging for signal direction is inconsistent) — it can exclude a genuinely-relevant signal or include a marginal one; the debug panel (Calibration → Real-World Signal Knowledge) is where you'd notice and correct that.
- Timing inference needs real evidence (stop/depart pairs or manual taps) — most signals on a first drive will be `UNKNOWN`, by design; it takes repeat drives to build usable models.
- No per-step speed limits from the routing provider are used yet (one conservative corridor-wide limit); no time-of-day timing profiles yet (a model is a single snapshot, though it does decay with staleness).
- Map matching is local geometric projection onto the fetched route, not a server-side map-matching service.
- Free Drive (no destination, predict the path as you go) is an intentional non-goal for this pass — `FreeDriveRoutePredictor` is a named extension point, not implemented.
- No accounts, crowdsourcing backend, computer vision, or native app yet — by design (see Roadmap).

## Roadmap

- `FreeDriveRoutePredictor` — turn-by-turn-free guidance once destination mode is proven out.
- Crowdsourced signal timing (aggregate observations across users) and official SPaT/MAP integration where cities publish it.
- Time-of-day timing profiles instead of one snapshot model per signal.
- Native iPhone app + CarPlay, reusing the same `src/lib` engine (it has zero React/DOM dependencies).
- Per-step speed limits and server-side map matching for higher-fidelity route projection.

---

*Advisory only — obey traffic laws and roadway conditions.*
