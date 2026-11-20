import { describe, expect, it } from 'vitest';
import { NO_OPTIONS, parseList, parsePriority, readOptions, writeOptions } from './options';

describe('readOptions', () => {
  it('reads an empty query as no options: every field at its default', () => {
    expect(readOptions('')).toEqual({
      building: 'W41', name: '', palette: '', priority: ['subway', 'bus', 'shuttle', 'bikes'],
      inset: 0, lat: '', lon: '', pin: [], hide: [],
    });
    expect(readOptions('')).toEqual(NO_OPTIONS);
  });
  it('trims the building, and reads a blank one as the default', () => {
    expect(readOptions('?building=%2032%20').building).toBe('32');
    expect(readOptions('?building=%20%20').building).toBe('W41');
  });
  it('reads only a palette it knows', () => {
    expect(readOptions('?palette=apricot').palette).toBe('apricot');
    expect(readOptions('?palette=rotate').palette).toBe('rotate');
    expect(readOptions('?palette=plaid').palette).toBe('');
  });
  it('clamps inset to 0-10, and ignores one that is not a number', () => {
    expect(readOptions('?inset=3').inset).toBe(3);
    expect(readOptions('?inset=40').inset).toBe(10);
    expect(readOptions('?inset=-2').inset).toBe(0);
    expect(readOptions('?inset=abc').inset).toBe(0);
  });
  it('keeps lat and lon only when each is a number', () => {
    expect(readOptions('?lat=42.36&lon=-71.09')).toMatchObject({ lat: '42.36', lon: '-71.09' });
    expect(readOptions('?lat=abc&lon=-71')).toMatchObject({ lat: '', lon: '-71' });
  });
  it('reads comma-separated ids, ignoring blanks and repeats', () => {
    const o = readOptions('?pin=place-knncl,%202168&hide=mbta:70,,1,1');
    expect(o.pin).toEqual(['place-knncl', '2168']);
    expect(o.hide).toEqual(['mbta:70', '1']);
    expect(readOptions('?pin=,').pin).toEqual([]);
  });
});

describe('priority', () => {
  it('puts the named panels first and keeps the rest in default order', () => {
    expect(readOptions('?priority=shuttle,subway').priority).toEqual(['shuttle', 'subway', 'bus', 'bikes']);
  });
  it('ignores unknown and repeated names', () => {
    expect(parsePriority('bikes, ferry,bikes,,bus')).toEqual(['bikes', 'bus', 'subway', 'shuttle']);
    expect(readOptions('?priority=nonsense').priority).toEqual(NO_OPTIONS.priority);
  });
});

describe('writeOptions', () => {
  it('writes nothing for no options', () => {
    expect(writeOptions(NO_OPTIONS)).toBe('');
  });
  it('keeps lists readable', () => {
    expect(writeOptions(readOptions('?hide=mbta:70,1'))).toBe('?hide=mbta:70,1');
  });
  it.each([
    '?building=32&name=Stata+Center&palette=pink',
    '?building=7&lat=42.36&lon=-71.09',
    '?priority=shuttle,subway,bus,bikes&inset=2.5',
    '?palette=mit&pin=place-knncl&hide=1,mbta:a1',
  ])('writes back the query it read: %s', (search) => {
    expect(writeOptions(readOptions(search))).toBe(search);
  });
});

describe('parseList', () => {
  it('splits on commas, trimming and dropping blanks and repeats', () => {
    expect(parseList(' 70, mbta:1,,70 ')).toEqual(['70', 'mbta:1']);
  });
});
