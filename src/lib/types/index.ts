/**
 * Core domain types for the Green Wave engine.
 *
 * Internal units are SI (meters, meters/second, seconds, epoch milliseconds)
 * everywhere except where a field name says otherwise. Conversion to
 * mph/feet/miles happens only at display boundaries (see src/lib/geo/units.ts).
 */

export type SignalPhaseName = "green" | "yellow" | "red";

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
  signalPlan: SignalPlan;
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
  /** Phase the signal is in at the queried timestamp. */
  phase: SignalPhaseName;
  /** Seconds remaining in the current phase. */
  secondsRemainingInPhase: number;
  /** Epoch ms of the next phase transition. */
  nextTransitionAt: number;
  /** Epoch ms of the next moment this signal turns green (may equal now if already green). */
  nextGreenAt: number;
  /** Epoch ms the green window (containing nextGreenAt) ends. */
  nextGreenEndsAt: number;
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
 * Abstraction over "where do we get signal timing from". V1 ships only
 * StaticSignalTimingProvider (manually calibrated demo data), but the
 * interface is designed so LearnedSignalTimingProvider,
 * CrowdsourcedSignalTimingProvider, and SpatSignalTimingProvider can be
 * dropped in later without touching the optimizer or UI.
 */
export interface SignalTimingProvider {
  getSignalPrediction(intersectionId: string, timestamp: number): Promise<SignalPrediction>;
}
