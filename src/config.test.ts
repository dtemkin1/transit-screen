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
    expect(c.location).toEqual({ lat: 42.35982, lon: -71.0961 });
    expect(c.modes.subway.maxWalkMin).toBe(15);
    expect(c.modes.bikes).toEqual({ maxWalkMin: 4, maxStations: 4 });
  });
  it('applies URL overrides', () => {
    const c = resolveConfig('?lat=42.36&lon=-71.09&name=Stata');
    expect(c.location).toEqual({ lat: 42.36, lon: -71.09 });
    expect(c.name).toBe('Stata');
  });
  it('ignores non-numeric lat/lon', () => {
    expect(resolveConfig('?lat=abc&lon=-71').location).toEqual(defaultConfig.location);
  });
});
