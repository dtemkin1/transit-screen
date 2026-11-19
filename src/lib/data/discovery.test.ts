import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig, type Config } from '../../config';
import { discover, type DiscoveryDeps } from './discovery';
import type { FeedCandidates } from '../feeds/types';
import type { Station, Stop } from '../types';

const O = defaultConfig.location;
const at = (dLat: number) => ({ lat: O.lat + dLat, lon: O.lon });

const stop = (id: string, mode: 'subway' | 'bus', dLat: number): Stop => ({
  id, source: 'mbta', mode, name: id, ...at(dLat), platformIds: [id], walkSec: 0, walkEstimated: false,
});

const mbta = (subway: Stop[], bus: Stop[] = []): Stop[] => [...subway, ...bus];

/** A GTFS feed's discovery result: its stops, one route, and the stops that route boards at. */
function gtfsFeed(source: string, ids: string[]): FeedCandidates {
  const mode = source === 'mit' ? 'shuttle' : 'bus';
  return {
    data: { source },
    stops: ids.map((id, i) => ({
      id, source, mode, name: id, ...at(0.0005 * (i + 1)), platformIds: [id], walkSec: 0, walkEstimated: false,
    })),
    routes: [{ id: 'r1', source, mode, shortName: 'R', longName: 'Route', color: '#000000', textColor: '#FFFFFF' }],
    serving: new Map([['r1:Kendall', new Set(ids)]]),
  };
}

const docks = (n: number): Station[] => Array.from({ length: n }, (_, i) => ({
  id: `b${i}`, source: 'bluebikes', mode: 'bikes', unit: { one: 'bike' }, name: `B${i}`, ...at(0.0002 * (i + 1)), walkSec: 0,
}));

interface Fakes {
  mbtaStops(): Promise<Stop[]>;
  gtfs(id: string): Promise<FeedCandidates>;
  stations(): Promise<Station[]>;
  walk: DiscoveryDeps['walk'];
}

function deps(over: Partial<Fakes> = {}): DiscoveryDeps {
  const f: Fakes = {
    mbtaStops: async () => [],
    gtfs: async (id) => gtfsFeed(id, []),
    stations: async () => [],
    walk: async (_o, targets) => targets.map(() => 100),
    ...over,
  };
  return {
    async candidates(feed) {
      if (feed.kind === 'mbta') return { data: null, stops: await f.mbtaStops() };
      if (feed.kind === 'gtfs') return f.gtfs(feed.id);
      return { data: { statusUrl: 'https://status' }, stations: await f.stations() };
    },
    walk: f.walk,
  };
}

const cfg = (over: Partial<Config> = {}): Config => ({ ...defaultConfig, ...over });

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('discover', () => {
  it('keeps Kendall (660 s) and drops Kenmore (1260 s) for subway 15 min', async () => {
    const d = await discover(cfg(), deps({
      mbtaStops: async () => mbta([stop('Kendall', 'subway', 0.002), stop('Kenmore', 'subway', 0.003)]),
      walk: async () => [660, 1260],
    }));
    expect(d.stops.map((s) => s.id)).toEqual(['Kendall']);
    expect(d.stops[0].walkSec).toBe(660);
    expect(d.stops[0].walkEstimated).toBe(false);
  });

  it('haversine-filters MBTA candidates beyond the candidate radius before walking', async () => {
    const walk = vi.fn(async (_o: unknown, t: unknown[]) => t.map(() => 60));
    const d = await discover(cfg(), deps({
      mbtaStops: async () => mbta([stop('near', 'subway', 0.002), stop('far', 'subway', 0.1)]),
      walk,
    }));
    expect(walk.mock.calls[0][1]).toHaveLength(1);
    expect(d.stops.map((s) => s.id)).toEqual(['near']);
  });

  it('null walk time excludes the stop', async () => {
    const d = await discover(cfg(), deps({
      mbtaStops: async () => mbta([stop('a', 'subway', 0.001), stop('b', 'subway', 0.002)]),
      walk: async () => [null, 100],
    }));
    expect(d.stops.map((s) => s.id)).toEqual(['b']);
  });

  it('pinned stop kept even if beyond limit', async () => {
    const d = await discover(cfg({ pin: ['slow'] }), deps({
      mbtaStops: async () => mbta([stop('slow', 'subway', 0.002), stop('slow2', 'subway', 0.003)]),
      walk: async () => [5000, 5000],
    }));
    expect(d.stops.map((s) => s.id)).toEqual(['slow']);
  });

  it('hide removes stop', async () => {
    const d = await discover(cfg({ hide: ['a'] }), deps({
      mbtaStops: async () => mbta([stop('a', 'subway', 0.001), stop('b', 'subway', 0.002)]),
    }));
    expect(d.stops.map((s) => s.id)).toEqual(['b']);
  });

  it('walk failure → fallback estimates, walkEstimated true', async () => {
    const d = await discover(cfg(), deps({
      mbtaStops: async () => mbta([stop('a', 'subway', 0.002)]),
      walk: async () => { throw new Error('down'); },
    }));
    expect(d.stops).toHaveLength(1);
    expect(d.stops[0].walkEstimated).toBe(true);
    expect(d.stops[0].walkSec).toBeGreaterThan(0);
    expect(d.stops[0].walkSec).toBeLessThan(900);
  });

  it('a GTFS failure leaves MBTA stops intact', async () => {
    const d = await discover(cfg(), deps({
      mbtaStops: async () => mbta([stop('a', 'subway', 0.001)]),
      gtfs: async () => { throw new Error('zip'); },
    }));
    expect(d.stops.map((s) => s.id)).toEqual(['a']);
    expect(d.feeds).not.toHaveProperty('mit');
    expect(d.feeds).toHaveProperty('mbta');
  });

  it('an MBTA failure leaves GTFS stops intact', async () => {
    const d = await discover(cfg(), deps({
      mbtaStops: async () => { throw new Error('mbta'); },
      gtfs: async (id) => gtfsFeed(id, id === 'mit' ? ['m1'] : []),
    }));
    expect(d.stops.map((s) => s.id)).toEqual(['m1']);
    expect(d.stops[0]).toMatchObject({ source: 'mit', mode: 'shuttle', platformIds: ['m1'] });
    expect(d.routes.has('mit:r1')).toBe(true);
    expect(d.feeds).toHaveProperty('mit');
    expect(d.serving.get('mit:r1:Kendall')).toEqual(new Set(['mit:m1']));
  });

  it('stations limited to the nearest 4 of their feed by walk time, with its data', async () => {
    const d = await discover(cfg(), deps({
      stations: async () => docks(6),
      walk: async (_o, t) => t.map((_, i) => 200 - i * 10),
    }));
    expect(d.stations).toHaveLength(4);
    const secs = d.stations.map((b) => b.walkSec);
    expect(secs).toEqual([...secs].sort((a, b) => a - b));
    expect(d.feeds.bluebikes).toEqual({ statusUrl: 'https://status' });
  });

  it('drops stations beyond the walk radius of their feed before walking', async () => {
    const far = { ...docks(1)[0], id: 'far', ...at(0.05) };
    const walk = vi.fn(async (_o: unknown, t: unknown[]) => t.map(() => 60));
    const d = await discover(cfg(), deps({ stations: async () => [...docks(1), far], walk }));
    expect(walk.mock.calls[0][1]).toHaveLength(1);
    expect(d.stations.map((s) => s.id)).toEqual(['b0']);
  });

  it('sends the walk service coordinates only', async () => {
    const walk = vi.fn(async (_o: unknown, t: unknown[]) => t.map(() => 60));
    await discover(cfg(), deps({ mbtaStops: async () => mbta([stop('a', 'subway', 0.001)]), walk }));
    expect(walk.mock.calls[0][1]).toEqual([at(0.001)]);
  });

  it('caps walk targets at 500 and estimates the rest', async () => {
    const many = Array.from({ length: 600 }, (_, i) => stop(`s${i}`, 'subway', 0.0001 + i * 0.000001));
    const walk = vi.fn(async (_o: unknown, t: unknown[]) => t.map(() => 100));
    const d = await discover(cfg(), deps({ mbtaStops: async () => mbta(many), walk }));
    expect(walk.mock.calls[0][1]).toHaveLength(500);
    expect(d.stops).toHaveLength(600);
    expect(d.stops.filter((s) => s.walkEstimated)).toHaveLength(100);
  });
});
