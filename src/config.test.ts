import { describe, it, expect } from 'vitest';
import { configSearch, resolveConfig, defaultConfig, parsePriority } from './config';
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

describe('pin and hide', () => {
  it('read comma-separated ids, ignoring blanks', () => {
    const c = resolveConfig('?pin=place-knncl,%202168&hide=mbta:70,,1');
    expect(c.pin).toEqual(['place-knncl', '2168']);
    expect(c.hide).toEqual(['mbta:70', '1']);
  });
  it('default to empty', () => {
    expect(resolveConfig('?pin=,').pin).toEqual([]);
  });
});

describe('configSearch', () => {
  it('is empty for the default board', () => {
    expect(configSearch(resolveConfig(''))).toBe('');
  });
  it('leaves out what the building implies (name, palette, location from the map)', () => {
    expect(configSearch(resolveConfig('?building=32&palette=mit'))).toBe('?building=32');
    expect(configSearch(resolveConfig('?palette=rotate&name=Metropolitan%20Warehouse'))).toBe('');
  });
  it('keeps lists readable', () => {
    expect(configSearch(resolveConfig('?hide=mbta:70,1'))).toBe('?hide=mbta:70,1');
  });
  it.each([
    '?building=32&name=Stata%20Center&palette=pink',
    '?building=7&lat=42.36&lon=-71.09',
    '?lat=42.36&lon=-71.09',
    '?priority=shuttle,subway&inset=2.5',
    '?palette=mit&pin=place-knncl&hide=1,mbta:a1',
    '?building=E14&palette=rotate',
  ])('reads back as the same config: %s', (search) => {
    const cfg = resolveConfig(search);
    expect(resolveConfig(configSearch(cfg))).toEqual(cfg);
  });
});
