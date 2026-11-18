import { describe, expect, it } from 'vitest';
import { EZRIDE_COLOR, countNoun, plural, routeBadge, shortStopName } from './display';
import type { RouteInfo } from './types';

const route = (o: Partial<RouteInfo>): RouteInfo => ({
  id: 'r', source: 'mbta', mode: 'bus', shortName: '', longName: '', color: '#123456', textColor: '#FFFFFF', ...o,
});

describe('shortStopName', () => {
  it('abbreviates common street words', () => {
    expect(shortStopName('Massachusetts Ave @ Albany St')).toBe('Mass Ave @ Albany St');
    expect(shortStopName('Vassar Street opp Pacific Street')).toBe('Vassar St opp Pacific St');
    expect(shortStopName('77 Massachusetts Avenue')).toBe('77 Mass Ave');
  });
  it('drops a trailing period and leaves other names alone', () => {
    expect(shortStopName('Erie St.')).toBe('Erie St');
    expect(shortStopName('Kendall Square T')).toBe('Kendall Square T');
  });
});

describe('routeBadge', () => {
  it('every EZRide route is "EZ" in the agency color', () => {
    for (const color of ['#91268E', '#6BAED6']) {
      expect(routeBadge(route({ source: 'ezride', shortName: 'EZRide', color }))).toEqual({
        text: 'EZ', bg: EZRIDE_COLOR, fg: '#FFFFFF',
      });
    }
  });
  it('short names fit as is; long names become initials', () => {
    expect(routeBadge(route({ shortName: '1', color: '#FFC72C', textColor: '#000000' })))
      .toEqual({ text: '1', bg: '#FFC72C', fg: '#000000' });
    expect(routeBadge(route({ source: 'mit', shortName: 'Tech Shuttle' })).text).toBe('TS');
    expect(routeBadge(route({ mode: 'subway', shortName: '', longName: 'Red Line' })).text).toBe('RL');
  });
  it('falls back to neutral colors when a route has none', () => {
    expect(routeBadge(route({ shortName: '9', color: '', textColor: '' }))).toMatchObject({ bg: '#5F6368', fg: '#FFFFFF' });
  });
});

describe('countNoun', () => {
  it('pluralizes', () => {
    expect(countNoun(1, 'bike')).toBe('1 bike');
    expect(countNoun(0, 'dock')).toBe('0 docks');
    expect(countNoun(17, 'dock')).toBe('17 docks');
    expect(plural(1, 'bike')).toBe('bike');
    expect(plural(2, 'bike')).toBe('bikes');
  });
});
