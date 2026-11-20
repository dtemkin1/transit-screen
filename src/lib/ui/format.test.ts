import { describe, expect, it } from 'vitest';
import { abbreviate, alertSegments, contrastRatio, countNoun, plural, routeBadge, splitVia } from './format';
import type { RouteInfo } from '../types';

const route = (o: Partial<RouteInfo>): RouteInfo => ({
  id: 'r', source: 'mbta', mode: 'bus', shortName: '', longName: '', color: '#123456', textColor: '#FFFFFF', ...o,
});

describe('abbreviate', () => {
  it('abbreviates common street words', () => {
    expect(abbreviate('Massachusetts Ave @ Albany St')).toBe('Mass Ave @ Albany St');
    expect(abbreviate('Vassar Street opp Pacific Street')).toBe('Vassar St opp Pacific St');
    expect(abbreviate('77 Massachusetts Avenue')).toBe('77 Mass Ave');
  });
  it('drops a trailing period and leaves other names alone', () => {
    expect(abbreviate('Erie St.')).toBe('Erie St');
    expect(abbreviate('Harvard')).toBe('Harvard');
    expect(abbreviate('Andrew')).toBe('Andrew');
  });
  it('uses the MBTA sign forms for squares, roads and "and"', () => {
    expect(abbreviate('Kendall Square T')).toBe('Kendall Sq T');
    expect(abbreviate('Spring Hill via Union Square and Somerville Avenue')).toBe('Spring Hill via Union Sq & Somerville Ave');
    expect(abbreviate('Fresh Pond Parkway at Huron Avenue')).toBe('Fresh Pond Pkwy at Huron Ave');
    expect(abbreviate('Soldiers Field Road / Western Boulevard')).toBe('Soldiers Field Rd / Western Blvd');
  });
});

describe('splitVia', () => {
  it('separates the destination from its route description', () => {
    expect(splitVia('Spring Hill via Union Sq')).toEqual({ dest: 'Spring Hill', via: ' via Union Sq' });
    expect(splitVia('Harvard')).toEqual({ dest: 'Harvard', via: '' });
    expect(splitVia('via Somewhere')).toEqual({ dest: 'via Somewhere', via: '' });
  });
});

describe('routeBadge', () => {
  it('a fixed badge text on the route wins over its name', () => {
    expect(routeBadge(route({ shortName: 'EZRide', badge: 'EZ', color: '#1F77B4', textColor: '#FFFFFF' })))
      .toEqual({ text: 'EZ', bg: '#1F77B4', fg: '#FFFFFF' });
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

describe('alertSegments', () => {
  const alert = (header: string, agency?: string) => ({ header, agency });
  const bold = { cls: 'agency', keep: true };

  it('joins the agency to a label the alert opens with, so there is one colon', () => {
    expect(alertSegments(alert('Red Line: Shuttle buses replace trains.', 'MBTA'))).toEqual([
      { text: 'MBTA Red Line:', ...bold }, { text: ' Shuttle buses replace trains.' },
    ]);
    expect(alertSegments(alert('Kendall/MIT: The elevator is out of service.', 'MBTA'))[0].text).toBe('MBTA Kendall/MIT:');
  });

  it('leads with the agency alone when the alert opens with no label', () => {
    expect(alertSegments(alert('Buses detour via Main St this week.', 'EZRide'))).toEqual([
      { text: 'EZRide:', ...bold }, { text: ' Buses detour via Main St this week.' },
    ]);
    // A time's colon, or one deep in a sentence, isn't a label.
    expect(alertSegments(alert('9:30 PM trips are cancelled.', 'MBTA'))[0].text).toBe('MBTA:');
    expect(alertSegments(alert('Expect delays. Reason: a disabled train.', 'MBTA'))[0].text).toBe('MBTA:');
  });

  it('adds nothing when the alert already starts with the agency, or has none', () => {
    expect(alertSegments(alert('MBTA: Fares change Monday.', 'MBTA'))).toEqual([{ text: 'MBTA: Fares change Monday.' }]);
    expect(alertSegments(alert('Red Line: Delays.'))).toEqual([{ text: 'Red Line: Delays.' }]);
  });
});
