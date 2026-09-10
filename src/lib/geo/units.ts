/** Unit conversions. Internal domain logic always uses SI (meters, m/s); these are for display only. */

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;
const MPS_PER_MPH = METERS_PER_MILE / 3600;

export function mpsToMph(mps: number): number {
  return mps / MPS_PER_MPH;
}

export function mphToMps(mph: number): number {
  return mph * MPS_PER_MPH;
}

export function metersToFeet(m: number): number {
  return m / METERS_PER_FOOT;
}

export function metersToMiles(m: number): number {
  return m / METERS_PER_MILE;
}

export function feetToMeters(ft: number): number {
  return ft * METERS_PER_FOOT;
}

export function milesToMeters(mi: number): number {
  return mi * METERS_PER_MILE;
}

/** Rounds mph to the nearest whole number for display, e.g. speedometer readouts. */
export function roundMph(mps: number): number {
  return Math.round(mpsToMph(mps));
}

/** Formats a distance in meters as a compact display string, e.g. "410 ft" or "0.8 mi". */
export function formatDistance(m: number): string {
  if (m < 0) return "0 ft";
  const feet = metersToFeet(m);
  if (feet < 1000) {
    return `${Math.round(feet)} ft`;
  }
  const miles = metersToMiles(m);
  return `${miles.toFixed(1)} mi`;
}

/** Formats a duration in seconds as "Ns" or "M:SS". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}
