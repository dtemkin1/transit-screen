import { describe, it, expect } from 'vitest';
import { resolveConfig, defaultConfig, parsePriority, pickWorkerUrl } from './config';
import { walkLimits } from './lib/feeds';

describe('priority', () => {
  it('defaults to Red Line, buses, shuttles, Bluebikes', () => {
    expect(resolveConfig('').priority).toEqual(['subway', 'bus', 'shuttle', 'bikes']);
  });
  it('?priority= puts the named panels first and keeps the rest in default order', () => {
    expect(resolveConfig('?priority=shuttle,subway').priority).toEqual(['shuttle', 'subway', 'bus', 'bikes']);
  });
  it('ignores unknown and repeated names', () => {
    expect(parsePriority('bikes, ferry,bikes,,bus')).toEqual(['bikes', 'bus', 'subway', 'shuttle']);
    expect(resolveConfig('?priority=nonsense').priority).toEqual(defaultConfig.priority);
  });
});

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
    expect(c.building).toBe('W41');
    expect(c.name).toBe('Metropolitan Warehouse');
    expect(c.location).toEqual({ lat: 42.35982, lon: -71.0961 });
    expect(c.feeds.map((f) => [f.id, walkLimits(f)])).toEqual([
      ['mbta', { subway: 15, bus: 7 }],
      ['mit', { shuttle: 5 }],
      ['ezride', { bus: 6 }],
      ['bluebikes', { bikes: 8 }],
    ]);
    expect(c.feeds.find((f) => f.id === 'bluebikes')).toMatchObject({ maxStations: 4 });
  });
  it('applies URL overrides', () => {
    const c = resolveConfig('?lat=42.36&lon=-71.09&building=32&name=Stata%20Center');
    expect(c.location).toEqual({ lat: 42.36, lon: -71.09 });
    expect(c.building).toBe('32');
    expect(c.name).toBe('Stata Center');
  });
  it('palette rotates daily by default and can be pinned from the URL', () => {
    expect(resolveConfig('').palette).toBe('rotate');
    expect(resolveConfig('?palette=apricot').palette).toBe('apricot');
    expect(resolveConfig('?palette=rotate').palette).toBe('rotate');
    expect(resolveConfig('?palette=plaid').palette).toBe('rotate');
  });
  it('inset (overscan margin, % of the shorter side) defaults to 0 and is clamped to 0-10', () => {
    expect(resolveConfig('').inset).toBe(0);
    expect(resolveConfig('?inset=3').inset).toBe(3);
    expect(resolveConfig('?inset=40').inset).toBe(10);
    expect(resolveConfig('?inset=-2').inset).toBe(0);
    expect(resolveConfig('?inset=abc').inset).toBe(0);
  });
  it('another building drops the W41 name and SA+P colors for MIT red, unless given', () => {
    expect(resolveConfig('?building=32').name).toBe('');
    expect(resolveConfig('?building=32').palette).toBe('mit');
    expect(resolveConfig('?building=7&palette=pink').palette).toBe('pink');
  });
  it('another building is looked up on the campus map, unless lat and lon are given', () => {
    expect(resolveConfig('').locate).toBe(false);
    expect(resolveConfig('?building=32').locate).toBe(true);
    expect(resolveConfig('?building=32&lat=42.36&lon=-71.09').locate).toBe(false);
    expect(resolveConfig('?building=32&lat=abc&lon=-71').locate).toBe(true);
    expect(resolveConfig('?building=%20%20').locate).toBe(false);
  });
  it('ignores non-numeric lat/lon', () => {
    expect(resolveConfig('?lat=abc&lon=-71').location).toEqual(defaultConfig.location);
  });
});
