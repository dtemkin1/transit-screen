import { describe, it, expect } from 'vitest';
import { resolveConfig, defaultConfig, pickWorkerUrl } from './config';

describe('pickWorkerUrl', () => {
  it('uses the configured URL when set', () => {
    expect(pickWorkerUrl('https://w.example')).toBe('https://w.example');
  });
  it('falls back to localhost when unset or empty', () => {
    expect(pickWorkerUrl(undefined)).toBe('http://localhost:8787');
    expect(pickWorkerUrl('')).toBe('http://localhost:8787');
  });
});

describe('resolveConfig', () => {
  it('defaults to W41', () => {
    const c = resolveConfig('');
    expect(c.name).toBe('W41');
    expect(c.place).toBe('Metropolitan Warehouse');
    expect(c.location).toEqual({ lat: 42.35982, lon: -71.0961 });
    expect(c.modes.subway.maxWalkMin).toBe(15);
    // 7 min: brings in the 70 at Mass Ave @ Sidney St (6.7 min walk) beside the 1 and the 85.
    expect(c.modes.bus.maxWalkMin).toBe(7);
    // 8 min: the nearest docks from W41 are 3.7, 4.1, 5.9 and 7.5 min away on foot.
    expect(c.modes.bikes).toEqual({ maxWalkMin: 8, maxStations: 4 });
  });
  it('applies URL overrides', () => {
    const c = resolveConfig('?lat=42.36&lon=-71.09&name=32&place=Stata%20Center');
    expect(c.location).toEqual({ lat: 42.36, lon: -71.09 });
    expect(c.name).toBe('32');
    expect(c.place).toBe('Stata Center');
  });
  it('palette rotates daily by default and can be pinned from the URL', () => {
    expect(resolveConfig('').palette).toBe('rotate');
    expect(resolveConfig('?palette=apricot').palette).toBe('apricot');
    expect(resolveConfig('?palette=rotate').palette).toBe('rotate');
    expect(resolveConfig('?palette=plaid').palette).toBe('rotate');
  });
  it('a new name without a place clears the default place', () => {
    expect(resolveConfig('?name=32').place).toBe('');
  });
  it('ignores non-numeric lat/lon', () => {
    expect(resolveConfig('?lat=abc&lon=-71').location).toEqual(defaultConfig.location);
  });
});
