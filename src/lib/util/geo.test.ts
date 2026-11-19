import { it, expect } from 'vitest';
import { haversineM, metresToDegrees, metresToRadiusDegrees, candidateRadiusM, fallbackWalkSec } from './geo';
import { defaultConfig } from '../../config';

const W41 = { lat: 42.35982, lon: -71.0961 };
const CENTRAL = { lat: 42.365304, lon: -71.103621 };

it('haversine W41→Central ≈ 870 m', () => expect(haversineM(W41, CENTRAL)).toBeCloseTo(870, -1));
it('metresToDegrees uses 111320 m/deg', () => expect(metresToDegrees(111_320)).toBe(1));
it('candidate radius for 15 min = 1170 m', () => expect(candidateRadiusM(15, defaultConfig)).toBe(1170));
it('fallback walk is ≥ straight line / speed', () =>
  expect(fallbackWalkSec(W41, CENTRAL, defaultConfig)).toBeCloseTo(870, -1));
it('fallback walk applies the detour factor and speed', () => {
  const cfg = { ...defaultConfig, walkDetourFactor: 1.5 };
  expect(fallbackWalkSec(W41, CENTRAL, cfg)).toBeCloseTo((haversineM(W41, CENTRAL) * 1.5) / cfg.walkSpeedMps, 6);
});
it('metresToRadiusDegrees scales by longitude degree size at the latitude', () => {
  expect(metresToRadiusDegrees(111_320, 0)).toBeCloseTo(1, 9);
  expect(metresToRadiusDegrees(1170, 42.35982)).toBeCloseTo(1170 / (111_320 * Math.cos((42.35982 * Math.PI) / 180)), 9);
  expect(metresToRadiusDegrees(1170, 42.35982)).toBeGreaterThan(metresToDegrees(1170));
});
