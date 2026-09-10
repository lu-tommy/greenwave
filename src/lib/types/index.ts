/**
 * Core domain types for the Green Wave engine.
 *
 * Internal units are SI (meters, meters/second, seconds, epoch milliseconds)
 * everywhere except where a field name says otherwise. Conversion to
 * mph/feet/miles happens only at display boundaries (see src/lib/geo/units.ts).
 */

/**
 * "unknown" means we have no trustworthy timing model for this signal at
 * all (its plan is `null`) — the engine must never report a green/yellow/red
 * guess in that case. This is distinct from low *confidence*, which still
 * carries a real (if shaky) SignalPlan.
 */
export type SignalPhaseName = "green" | "yellow" | "red" | "unknown";

export type LatLng = {
  lat: number;
  lng: number;
};

/**
 * The fixed timing plan for one signal. All durations are in seconds.
 * A cycle is modeled as green -> yellow -> red -> (repeat), starting the
 * cycle counter at green. `offsetSec` shifts when the cycle "starts"
 * relative to epoch 0, allowing corridors to coordinate lights.
 */
export type SignalPlan = {
  cycleSec: number;
  greenSec: number;
  yellowSec: number;
  redSec: number;
  offsetSec: number;
};

/** 0 (no confidence) - 1 (verified/official). */
export type Confidence = number;

export type Intersection = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Distance in meters from the corridor's start point. */
  distanceAlongCorridorM: number;
  /** `null` means no trustworthy timing model exists yet — never fabricate one. */
  signalPlan: SignalPlan | null;
  confidence: Confidence;
  lastCalibratedAt?: number;
};

export type Corridor = {
  id: string;
  name: string;
  /** Human-readable travel direction, e.g. "Eastbound". */
  direction: string;
  /** Posted legal speed limit, in meters/second (SI internally). */
  speedLimitMps: number;
  /** Ordered route geometry, start to end. */
  polyline: LatLng[];
  /** Ordered by distanceAlongCorridorM ascending. */
  intersections: Intersection[];
  /** e.g. "SIMULATED SIGNAL DATA" — must always be shown to the user. */
  dataSourceLabel: string;
};

export type SignalPrediction = {
  intersectionId: string;
  /** Phase the signal is in at the queried timestamp. "unknown" when there is no timing model. */
  phase: SignalPhaseName;
  /** Seconds remaining in the current phase. `null` when phase is "unknown". */
  secondsRemainingInPhase: number | null;
  /** Epoch ms of the next phase transition. `null` when phase is "unknown". */
  nextTransitionAt: number | null;
  /** Epoch ms of the next moment this signal turns green. `null` when phase is "unknown". */
  nextGreenAt: number | null;
  /** Epoch ms the green window (containing nextGreenAt) ends. `null` when phase is "unknown". */
  nextGreenEndsAt: number | null;
  confidence: Confidence;
};

/** A contiguous window during which a signal is green, in absolute epoch ms. */
export type GreenWindow = {
  startAt: number;
  endAt: number;
};

export type VehicleState = {
  /** Epoch ms. */
  timestamp: number;
  /** Distance in meters along the active corridor. */
  positionM: number;
  /** Current speed, meters/second. */
  speedMps: number;
};

export type DriveInstruction =
  | "HOLD"
  | "COAST"
  | "SLOW"
  | "ACCELERATE_GENTLY"
  | "PREPARE_TO_STOP";

export type UpcomingLightForecast = {
  intersectionId: string;
  name: string;
  distanceM: number;
  etaMs: number;
  predictedPhaseAtArrival: SignalPhaseName;
  arrivalConfidence: Confidence;
};

export type DriveRecommendation = {
  timestamp: number;
  instruction: DriveInstruction;
  /** Recommended target speed, meters/second. Always <= corridor speed limit. */
  targetSpeedMps: number;
  speedLimitMps: number;
  /** Number of consecutive upcoming greens this trajectory is expected to catch. */
  greenWaveCount: number;
  /** True when the recommendation reflects a real coordinated green-wave streak (>=2). */
  isGreenWave: boolean;
  upcoming: UpcomingLightForecast[];
  /** Overall confidence of this recommendation (min of contributing signal confidences). */
  confidence: Confidence;
  /** Human-readable one-line explanation, e.g. "RED AHEAD - NEXT GREEN IN 22s". */
  reason: string;
};

export type CandidateSpeedScore = {
  speedMps: number;
  score: number;
  stopsRequired: number;
  greensCaught: number;
  hardBrakingEvents: number;
  hardAccelEvents: number;
  travelTimeSec: number;
  feasible: boolean;
};

export type OptimizationResult = {
  recommendation: DriveRecommendation;
  /** Every candidate evaluated, for the debug panel. Empty in production hot paths if disabled. */
  candidates: CandidateSpeedScore[];
};

export type OptimizerConstraints = {
  /** m/s^2, positive. */
  maxAcceleration: number;
  /** m/s^2, positive (magnitude of deceleration). */
  maxComfortableDeceleration: number;
  /** m/s^2, positive. Above this is considered "hard braking". */
  hardBrakingThreshold: number;
  /** m/s^2, positive. Above this is considered "hard acceleration". */
  hardAccelThreshold: number;
  /** Lowest speed the optimizer will recommend while still "driving", m/s. */
  minUsefulSpeedMps: number;
  /** How many seconds ahead the optimizer looks. */
  horizonSec: number;
  /** How many intersections ahead the optimizer considers, at most. */
  maxIntersectionsAhead: number;
  /** 0-1, weight given to smoothness/comfort vs. raw green-catching/time. */
  comfortWeight: number;
  /** Candidate speed search step, m/s. */
  speedStepMps: number;
};

export type SimulationScenarioId =
  | "perfect-green-wave"
  | "missed-window"
  | "too-fast"
  | "stop-required"
  | "timing-uncertain";

export type SimulationScenario = {
  id: SimulationScenarioId;
  name: string;
  description: string;
  corridorId: string;
  /** Where along the corridor (meters) the simulated drive begins. */
  startPositionM: number;
  /** Initial speed, m/s. */
  startSpeedMps: number;
  /** Epoch ms simulation clock starts at. Chosen so scenario timing lines up with signal offsets. */
  startTimestamp: number;
};

export type DriveMetrics = {
  stops: number;
  hardBrakingEvents: number;
  hardAccelEvents: number;
  greensCaught: number;
  totalIntersections: number;
  tripTimeSec: number;
  distanceM: number;
};

export type SimulationState = {
  /** Simulated clock, epoch ms. Independent from wall-clock time. */
  timestamp: number;
  running: boolean;
  speedMultiplier: number;
  corridor: Corridor;
  vehicle: VehicleState;
  finished: boolean;
  metrics: DriveMetrics;
  /** Most recent optimizer output for this tick. */
  lastResult: OptimizationResult | null;
  /** History of speed samples, for charting/debug. */
  history: { timestamp: number; positionM: number; speedMps: number; targetSpeedMps: number }[];
};

/**
 * Abstraction over "where do we get signal timing from". Ships with
 * StaticSignalTimingProvider (manually calibrated demo/route data) and
 * LearnedSignalTimingProvider (inferred from real-world observations),
 * composed by ChainedSignalTimingProvider. The interface is designed so
 * CrowdsourcedSignalTimingProvider and SpatSignalTimingProvider can be
 * dropped in later without touching the optimizer or UI.
 */
export interface SignalTimingProvider {
  getSignalPrediction(intersectionId: string, timestamp: number): Promise<SignalPrediction>;
  /**
   * The provider's best current SignalPlan for this signal, independent of
   * any particular timestamp — used to build a Corridor once (e.g. after
   * route + signal discovery) rather than on every GPS tick. `plan: null`
   * means this provider has no trustworthy model for the signal.
   */
  getSignalPlan(intersectionId: string): Promise<{ plan: SignalPlan | null; confidence: Confidence }>;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** Ordered route geometry, start to end — a polyline like a Corridor's, just sourced from a routing provider. */
export type RouteGeometry = LatLng[];

export type RouteManeuverType =
  | "depart"
  | "turn"
  | "merge"
  | "roundabout"
  | "fork"
  | "continue"
  | "arrive"
  | "other";

export type RouteManeuver = {
  type: RouteManeuverType;
  /** e.g. "left", "right", "straight" — free-form, provider-dependent. */
  modifier?: string;
  instruction: string;
  location: LatLng;
};

export type RouteStep = {
  maneuver: RouteManeuver;
  distanceM: number;
  durationSec: number;
  geometry: RouteGeometry;
  /** Posted speed limit for this step if the routing provider supplies it, m/s. */
  speedLimitMps?: number;
  roadName?: string;
};

export type DestinationCandidate = {
  id: string;
  name: string;
  /** e.g. locality/address line, for disambiguation in the suggestion list. */
  description: string;
  location: LatLng;
};

export type Route = {
  id: string;
  origin: LatLng;
  destination: LatLng;
  destinationLabel: string;
  geometry: RouteGeometry;
  distanceM: number;
  durationSec: number;
  steps: RouteStep[];
  /** Fallback speed limit for legs without per-step data, m/s. Conservative — never invented high. */
  defaultSpeedLimitMps: number;
  /** Stable hash of origin+destination+geometry, used for caching and DriveSession.routeId. */
  routeHash: string;
  fetchedAt: number;
};

export type RouteProgress = {
  /** Distance along the route's geometry, meters. */
  distanceAlongRouteM: number;
  /** Perpendicular distance from the raw GPS fix to the route line, meters. */
  offRouteM: number;
  /** True once offRouteM exceeds the off-route threshold. */
  offRoute: boolean;
  /** Route heading (deg) at the matched point, for direction sanity checks. */
  routeHeadingDeg: number;
};

/**
 * Routing is intentionally decoupled from React and from any specific
 * provider. MapboxRoutingProvider is the only real implementation (via a
 * server-side proxy, see src/app/api/routing/*); tests use a mock.
 */
export interface RoutingProvider {
  searchDestination(query: string, proximity?: LatLng): Promise<DestinationCandidate[]>;
  getRoute(origin: LatLng, destination: LatLng, options?: { profile?: "driving" | "driving-traffic" }): Promise<Route>;
}

// ---------------------------------------------------------------------------
// Automatic traffic signal discovery
// ---------------------------------------------------------------------------

/**
 * A traffic signal found near a route, before it's been resolved into a
 * full Intersection. `id` is a stable, provider-scoped identity (e.g.
 * "osm:node:123456789") so the same physical signal maps back to the same
 * learned model across drives — never a transient array index.
 */
export type DiscoveredSignal = {
  id: string;
  lat: number;
  lng: number;
  distanceAlongRouteM: number;
  perpendicularDistanceM: number;
  /** Route heading (deg) at the nearest route point, for direction reasoning. */
  routeHeadingDeg: number;
  /** 0-1: confidence that this signal actually applies to travel in the route's direction (not a crossing/opposite-carriageway signal). */
  directionConfidence: Confidence;
  roadName?: string;
  intersectionName?: string;
  /** Raw OSM tags of interest, kept for the debug panel — not parsed further than needed. */
  metadata?: Record<string, string>;
  firstSeen: number;
  lastSeen: number;
};

/**
 * Discovery is a distinct concern from timing: it only answers "what
 * signals exist near this route geometry", never "what phase are they in".
 * OsmTrafficSignalDiscoveryProvider is the only implementation; Overpass
 * specifics stay behind it and the /api/signals/discover proxy.
 */
export interface TrafficSignalDiscoveryProvider {
  getSignalsNearRoute(route: Route): Promise<DiscoveredSignal[]>;
}

// ---------------------------------------------------------------------------
// Signal knowledge store (learned, real-world timing)
// ---------------------------------------------------------------------------

/** A SignalPlan the learner is not fully confident in, plus how it was derived — kept distinct from a verified plan. */
export type LearnedTimingModel = SignalPlan & {
  confidence: Confidence;
  /** How many anchor observations contributed. */
  sampleCount: number;
  updatedAt: number;
};

export type SignalKnowledgeRecord = {
  signalId: string;
  lat: number;
  lng: number;
  /** Route heading (deg) this model applies to — direction-specific, per physical approach. */
  direction: number | null;
  /** `null` until enough evidence exists to infer a model — never fabricated. */
  timingModel: LearnedTimingModel | null;
  observationCount: number;
  firstObservedAt: number;
  lastObservedAt: number;
};

export type ObservationType =
  | "STOP_AT_SIGNAL"
  | "DEPART_SIGNAL"
  | "PASS_SIGNAL_WITHOUT_STOP"
  | "GREEN_START_MANUAL"
  | "RED_START_MANUAL";

/** A compact, timestamped record of one moment during a real drive approach to one signal. */
export type DriveObservation = {
  id: string;
  signalId: string;
  driveSessionId: string;
  type: ObservationType;
  /** Real absolute epoch ms — never the simulator's injected clock. */
  timestamp: number;
  lat: number;
  lng: number;
  speedMps: number;
  distanceToSignalM: number;
  routeHeadingDeg: number;
  /** 0-1: how much this single observation should weigh in inference (manual taps are highest). */
  confidence: Confidence;
};

export type DriveSession = {
  id: string;
  origin: LatLng;
  destination: LatLng;
  destinationLabel: string;
  routeId: string;
  routeHash: string;
  startedAt: number;
  endedAt: number | null;
  distanceM: number;
  durationSec: number;
  signalsEncountered: number;
  knownSignalsEncountered: number;
  stops: number;
  observationIds: string[];
};
