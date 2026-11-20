import type { LatLon } from '../types';
import type { Config } from '../config/resolve';

const EARTH_RADIUS_M = 6_371_000;
const METRES_PER_DEGREE = 111_320;

const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function metresToDegrees(m: number): number {
  return m / METRES_PER_DEGREE;
}

export function candidateRadiusM(maxWalkMin: number, cfg: Config): number {
  return maxWalkMin * 60 * cfg.walkSpeedMps;
}

export function fallbackWalkSec(from: LatLon, to: LatLon, cfg: Config): number {
  return (haversineM(from, to) * cfg.walkDetourFactor) / cfg.walkSpeedMps;
}

/** Degree-space radius whose circle covers the metre circle at this latitude (sized by longitude degrees, the shorter axis). */
export function metresToRadiusDegrees(m: number, lat: number): number {
  return m / (METRES_PER_DEGREE * Math.cos(rad(lat)));
}
