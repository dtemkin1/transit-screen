import { describe, expect, it } from 'vitest';
import { walkLimits } from '../feeds';
import { NO_OPTIONS, readOptions } from './options';
import { boardSearch, defaultConfig, resolveConfig } from './resolve';

const fromSearch = (search: string) => resolveConfig(readOptions(search));

describe('resolveConfig', () => {
  it('defaults to W41', () => {
    const c = resolveConfig({});
    expect(c).toEqual(defaultConfig);
    expect(c.building).toBe('W41');
    expect(c.name).toBe('Metropolitan Warehouse');
    expect(c.location).toEqual({ lat: 42.35982, lon: -71.0961 });
    expect(c.feeds.map((f) => [f.id, walkLimits(f)])).toEqual([
      ['mbta', { subway: 15, bus: 7 }],
      ['mit', { shuttle: 5 }],
      ['ezride', { bus: 6 }],
      ['bluebikes', { bikes: 8 }],
      ['longwood', { shuttle: 5 }],
    ]);
    expect(c.feeds.find((f) => f.id === 'bluebikes')).toMatchObject({ maxStations: 4 });
  });
  it('applies options', () => {
    const c = fromSearch('?lat=42.36&lon=-71.09&building=32&name=Stata%20Center');
    expect(c.location).toEqual({ lat: 42.36, lon: -71.09 });
    expect(c.building).toBe('32');
    expect(c.name).toBe('Stata Center');
    expect(fromSearch('?priority=shuttle,subway').priority).toEqual(['shuttle', 'subway', 'bus', 'bikes']);
    expect(fromSearch('?inset=3').inset).toBe(3);
    expect(fromSearch('?pin=a&hide=b').pin).toEqual(['a']);
  });
  it('palette rotates daily by default and can be pinned', () => {
    expect(resolveConfig({}).palette).toBe('rotate');
    expect(fromSearch('?palette=apricot').palette).toBe('apricot');
    expect(fromSearch('?palette=rotate').palette).toBe('rotate');
  });
  it('another building drops the W41 name and SA+P colors for MIT red, unless given', () => {
    expect(fromSearch('?building=32').name).toBe('');
    expect(fromSearch('?building=32').palette).toBe('mit');
    expect(fromSearch('?building=7&palette=pink').palette).toBe('pink');
  });
  it('another building is looked up on the campus map, unless lat and lon are both given', () => {
    expect(resolveConfig({}).locate).toBe(false);
    expect(fromSearch('?building=32').locate).toBe(true);
    expect(fromSearch('?building=32&lat=42.36&lon=-71.09').locate).toBe(false);
    expect(fromSearch('?building=32&lat=abc&lon=-71').locate).toBe(true);
    expect(resolveConfig({ building: '32', lat: '42.36' }).locate).toBe(true);
    expect(fromSearch('?building=%20%20').locate).toBe(false);
  });
  it('ignores a location missing lat or lon', () => {
    expect(fromSearch('?lat=abc&lon=-71').location).toEqual(defaultConfig.location);
  });
});

describe('boardSearch', () => {
  it('is empty for the default board', () => {
    expect(boardSearch(NO_OPTIONS)).toBe('');
  });
  it('leaves out what the building implies (name, palette, location from the map)', () => {
    expect(boardSearch(readOptions('?building=32&palette=mit'))).toBe('?building=32');
    expect(boardSearch(readOptions('?palette=rotate&name=Metropolitan%20Warehouse'))).toBe('');
    expect(boardSearch(readOptions('?lat=42.35982&lon=-71.0961'))).toBe('');
  });
  it('keeps what the building does not imply', () => {
    expect(boardSearch(readOptions('?building=E14&palette=rotate'))).toBe('?building=E14&palette=rotate');
  });
  it.each([
    '?building=32&name=Stata%20Center&palette=pink',
    '?building=7&lat=42.36&lon=-71.09',
    '?lat=42.36&lon=-71.09',
    '?priority=shuttle,subway&inset=2.5',
    '?palette=mit&pin=place-knncl&hide=1,mbta:a1',
    '?building=E14&palette=rotate',
  ])('reads back as the same board: %s', (search) => {
    const options = readOptions(search);
    expect(fromSearch(boardSearch(options))).toEqual(resolveConfig(options));
  });
});
