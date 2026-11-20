import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../config';
import type { Discovered } from '../data/discovery';
import type { Station, Stop } from '../types';
import { candidateRadiusM, metresToDegrees } from '../util/geo';
import { classify, failedFeeds, widen } from './nearby';

const O = defaultConfig.location;
/** A stop `metres` north of the board, `walkMin` minutes away on foot. */
const stop = (id: string, mode: 'subway' | 'bus', metres: number, walkMin: number, source = 'mbta'): Stop => ({
  id, source, mode, name: id, lat: O.lat + metresToDegrees(metres), lon: O.lon,
  platformIds: [id], walkSec: walkMin * 60, walkEstimated: false,
});
const dock = (id: string, walkMin: number): Station => ({
  id, source: 'bluebikes', mode: 'bikes', unit: { one: 'bike' }, name: id, lat: O.lat, lon: O.lon, walkSec: walkMin * 60,
});
const found = (stops: Stop[], stations: Station[] = []): Discovered =>
  ({ stops, stations, routes: new Map(), serving: new Map(), feeds: {} });

describe('classify', () => {
  // MBTA bus: 7 min limit, so a 546 m candidate circle.
  const circle = candidateRadiusM(7, defaultConfig);

  it('marks stops within the walk limit as shown, and nearby ones past it as pinnable', () => {
    const items = classify(found([
      stop('near', 'bus', 100, 3),
      stop('long-walk', 'bus', circle - 20, 11),
      stop('outside', 'bus', circle + 50, 9),
    ]), defaultConfig);
    expect(items.map((i) => [i.id, i.state])).toEqual([['near', 'shown'], ['long-walk', 'pinnable']]);
    expect(items[1]).toMatchObject({ walkMin: 11, limitMin: 7 });
  });

  it('offers docks only within their limit, since the board keeps just the nearest few', () => {
    expect(classify(found([], [dock('b1', 5), dock('b2', 12)]), defaultConfig).map((i) => i.id)).toEqual(['b1']);
  });

  it('orders by panel, then walk', () => {
    const items = classify(found([stop('bus', 'bus', 50, 2), stop('t2', 'subway', 50, 9), stop('t1', 'subway', 50, 4)]), defaultConfig);
    expect(items.map((i) => i.id)).toEqual(['t1', 't2', 'bus']);
  });
});

describe('failedFeeds', () => {
  it('names the feeds discovery could not read', () => {
    const d = { ...found([]), feeds: { bluebikes: {} } };
    expect(failedFeeds(d, defaultConfig)).toEqual(['MBTA', 'MIT shuttles', 'EZRide']);
    expect(failedFeeds({ ...d, feeds: { mbta: null, mit: {}, ezride: {}, bluebikes: {} } }, defaultConfig)).toEqual([]);
  });
});

describe('widen', () => {
  it('raises every walk limit, and the dock count', () => {
    const [mbta, , , bikes] = defaultConfig.feeds.map(widen);
    expect(mbta).toMatchObject({ walkMin: { subway: 45, bus: 21 } });
    expect(bikes).toMatchObject({ walkMin: 24, maxStations: 12 });
  });
});
