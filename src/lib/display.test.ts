import { describe, expect, it } from 'vitest';
import { EZRIDE_COLOR, contrastRatio, countNoun, plural, routeBadge, shortStopName } from './display';
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
  it('picks black or white text when the feed gives none, or one that does not read', () => {
    // Saferide Cambridge All: #E377C2 with no text color. White would be 2.6:1.
    expect(routeBadge(route({ source: 'mit', shortName: 'Saferide Cambridge All', color: '#E377C2', textColor: '' })).fg).toBe('#000000');
    // Tech Shuttle: dark red, white given and readable.
    expect(routeBadge(route({ source: 'mit', shortName: 'Tech Shuttle', color: '#843C39', textColor: '#FFFFFF' })).fg).toBe('#FFFFFF');
    // A given color that fails contrast is replaced.
    expect(routeBadge(route({ shortName: '1', color: '#FFC72C', textColor: '#FFFFFF' })).fg).toBe('#000000');
  });
  it('contrastRatio matches WCAG', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#DA291C', '#FFFFFF')).toBeCloseTo(4.84, 1);
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
