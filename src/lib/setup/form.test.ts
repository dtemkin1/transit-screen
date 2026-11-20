import { describe, expect, it } from 'vitest';
import { configSearch, resolveConfig } from '../../config';
import { formConfig, formFrom, formSearch, parseIds } from './form';

describe('setup form', () => {
  it('starts from the default board with every default field empty', () => {
    expect(formFrom('')).toEqual({
      building: 'W41', name: '', palette: '', priority: ['subway', 'bus', 'shuttle', 'bikes'],
      inset: 0, lat: '', lon: '', pin: [], hide: [],
    });
    expect(formSearch(formFrom(''))).toBe('');
  });

  it.each([
    '?building=32',
    '?building=32&name=Stata%20Center&palette=pink',
    '?building=7&lat=42.36&lon=-71.09',
    '?priority=shuttle,subway&inset=2.5&pin=place-knncl&hide=mbta:70',
  ])('gives back the board URL it was read from: %s', (search) => {
    expect(formSearch(formFrom(search))).toBe(configSearch(resolveConfig(search)));
    expect(formConfig(formFrom(search))).toEqual(resolveConfig(search));
  });

  it('leaves out what the building already implies', () => {
    expect(formSearch({ ...formFrom(''), building: '32', palette: 'mit' })).toBe('?building=32');
  });

  it('needs both lat and lon', () => {
    expect(formConfig({ ...formFrom('?building=32'), lat: '42.36' }).locate).toBe(true);
  });

  it('parses id lists', () => {
    expect(parseIds(' 70, mbta:1,,70 ')).toEqual(['70', 'mbta:1']);
  });
});
