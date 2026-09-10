/**
 * Simple kinematic approximation used to estimate arrival time at a future
 * point given a starting speed, a target (cruise) speed, and constant
 * acceleration/deceleration rates.
 *
 * Model: the vehicle accelerates or decelerates at a constant rate from
 * `currentSpeedMps` to `targetSpeedMps`, then cruises at `targetSpeedMps`
 * for the remainder of the distance. If the transition itself would cover
 * more than the available distance, we solve for the speed actually
 * reached at that distance instead (never overshoot the distance).
 *
 * This intentionally ignores road grade, curvature, and other vehicles —
 * sufficient for a V1 advisory tool, not a physics engine.
 */

export type ArrivalEstimate = {
  etaSec: number;
  /** Speed the vehicle is expected to be traveling at upon arrival, m/s. */
  arrivalSpeedMps: number;
};

export function estimateArrival(
  distanceM: number,
  currentSpeedMps: number,
  targetSpeedMps: number,
  maxAccelMps2: number,
  maxDecelMps2: number,
): ArrivalEstimate {
  if (distanceM <= 0) {
    return { etaSec: 0, arrivalSpeedMps: currentSpeedMps };
  }

  const speedDelta = targetSpeedMps - currentSpeedMps;
  const rate = speedDelta >= 0 ? maxAccelMps2 : maxDecelMps2;

  if (Math.abs(speedDelta) < 1e-6 || rate <= 0) {
    // No transition needed (or degenerate rate): cruise the whole distance.
    const speed = Math.max(currentSpeedMps, 0.1);
    return { etaSec: distanceM / speed, arrivalSpeedMps: currentSpeedMps };
  }

  // Distance covered while transitioning from current to target speed.
  const transitionTimeSec = Math.abs(speedDelta) / rate;
  const transitionDistanceM =
    currentSpeedMps * transitionTimeSec + 0.5 * (speedDelta >= 0 ? 1 : -1) * rate * transitionTimeSec ** 2;

  if (transitionDistanceM <= distanceM) {
    const cruiseDistanceM = distanceM - transitionDistanceM;
    const cruiseSpeed = Math.max(targetSpeedMps, 0.1);
    const cruiseTimeSec = cruiseDistanceM / cruiseSpeed;
    return {
      etaSec: transitionTimeSec + cruiseTimeSec,
      arrivalSpeedMps: targetSpeedMps,
    };
  }

  // Target speed is not reached before the distance runs out; solve the
  // quadratic v(t) for the time at which accumulated distance == distanceM.
  // distance = v0*t + 0.5*a*t^2 (a signed by direction of change)
  const a = 0.5 * rate * (speedDelta >= 0 ? 1 : -1);
  const b = currentSpeedMps;
  const c = -distanceM;
  let t: number;
  if (Math.abs(a) < 1e-9) {
    t = distanceM / Math.max(currentSpeedMps, 0.1);
  } else {
    const disc = b * b - 4 * a * c;
    const sqrtDisc = Math.sqrt(Math.max(disc, 0));
    const t1 = (-b + sqrtDisc) / (2 * a);
    const t2 = (-b - sqrtDisc) / (2 * a);
    t = Math.max(t1, t2, 0);
  }
  const arrivalSpeed = currentSpeedMps + (speedDelta >= 0 ? 1 : -1) * rate * t;
  return { etaSec: t, arrivalSpeedMps: Math.max(arrivalSpeed, 0) };
}
