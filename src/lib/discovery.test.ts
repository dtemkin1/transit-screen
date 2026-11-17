import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig, type Config } from '../config';
import { discover, type DiscoveryDeps } from './discovery';
import type { MbtaCandidates } from './mbta';
import type { PassioStatic } from './gtfs/passio-static';
import type { Stop } from './types';

const O = defaultConfig.location;
const at = (dLat: number) => ({ lat: O.lat + dLat, lon: O.lon });

const stop = (id: string, mode: 'subway' | 'bus', dLat: number): Stop => ({
  id, source: 'mbta', mode, name: id, ...at(dLat), platformIds: [id], walkSec: 0, walkEstimated: false,
});

const mbta = (subway: Stop[], bus: Stop[] = []): MbtaCandidates => ({ subway, bus, routes: new Map() });

function passio(source: 'mit' | 'ezride', ids: string[], served: string[]): PassioStatic {
  const mode = source === 'mit' ? 'shuttle' : 'ezride';
  return {
    source, mode,
    stops: new Map(ids.map((id, i) => [id, { id, name: id, ...at(0.0005 * (i + 1)) }])),
    routes: new Map([['r1', { id: 'r1', source, mode, shortName: 'R', longName: 'Route', color: '#000000', textColor: '#FFFFFF' }]]),
    trips: new Map(), calendar: new Map(), calendarDates: [],
    stopTimes: new Map([['t1', served.map((stopId, seq) => ({ stopId, seq, dep: '08:00:00' }))]]),
  };
}

const bikeJson = (n: number) => ({
  data: { stations: Array.from({ length: n }, (_, i) => ({ station_id: `b${i}`, name: `B${i}`, ...at(0.0002 * (i + 1)) })) },
});

function deps(over: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  return {
    mbtaCandidates: async () => mbta([]),
    passioStatic: async (a) => passio(a === 'mit' ? 'mit' : 'ezride', [], []),
    bikeInfo: async () => ({ info: { data: { stations: [] } }, statusUrl: 'https://status' }),
    walk: async (_o, targets) => targets.map(() => 100),
    ...over,
  };
}

const cfg = (over: Partial<Config> = {}): Config => ({ ...defaultConfig, ...over });

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('discover', () => {
  it('keeps Kendall (660 s) and drops Kenmore (1260 s) for subway 15 min', async () => {
    const d = await discover(cfg(), deps({
      mbtaCandidates: async () => mbta([stop('Kendall', 'subway', 0.002), stop('Kenmore', 'subway', 0.003)]),
      walk: async () => [660, 1260],
    }));
    expect(d.stops.map((s) => s.id)).toEqual(['Kendall']);
    expect(d.stops[0].walkSec).toBe(660);
    expect(d.stops[0].walkEstimated).toBe(false);
  });

  it('haversine-filters MBTA candidates beyond the candidate radius before walking', async () => {
    const walk = vi.fn(async (_o: unknown, t: unknown[]) => t.map(() => 60));
    const d = await discover(cfg(), deps({
      mbtaCandidates: async () => mbta([stop('near', 'subway', 0.002), stop('far', 'subway', 0.1)]),
      walk,
    }));
    expect(walk.mock.calls[0][1]).toHaveLength(1);
    expect(d.stops.map((s) => s.id)).toEqual(['near']);
  });

  it('null walk time excludes the stop', async () => {
    const d = await discover(cfg(), deps({
      mbtaCandidates: async () => mbta([stop('a', 'subway', 0.001), stop('b', 'subway', 0.002)]),
      walk: async () => [null, 100],
    }));
    expect(d.stops.map((s) => s.id)).toEqual(['b']);
  });

  it('pinned stop kept even if beyond limit', async () => {
    const d = await discover(cfg({ pin: ['slow'] }), deps({
      mbtaCandidates: async () => mbta([stop('slow', 'subway', 0.002), stop('slow2', 'subway', 0.003)]),
      walk: async () => [5000, 5000],
    }));
    expect(d.stops.map((s) => s.id)).toEqual(['slow']);
  });

  it('hide removes stop', async () => {
    const d = await discover(cfg({ hide: ['a'] }), deps({
      mbtaCandidates: async () => mbta([stop('a', 'subway', 0.001), stop('b', 'subway', 0.002)]),
    }));
    expect(d.stops.map((s) => s.id)).toEqual(['b']);
  });

  it('walk failure → fallback estimates, walkEstimated true', async () => {
    const d = await discover(cfg(), deps({
      mbtaCandidates: async () => mbta([stop('a', 'subway', 0.002)]),
      walk: async () => { throw new Error('down'); },
    }));
    expect(d.stops).toHaveLength(1);
    expect(d.stops[0].walkEstimated).toBe(true);
    expect(d.stops[0].walkSec).toBeGreaterThan(0);
    expect(d.stops[0].walkSec).toBeLessThan(900);
  });

  it('passio failure leaves MBTA stops intact', async () => {
    const d = await discover(cfg(), deps({
      mbtaCandidates: async () => mbta([stop('a', 'subway', 0.001)]),
      passioStatic: async () => { throw new Error('zip'); },
    }));
    expect(d.stops.map((s) => s.id)).toEqual(['a']);
    expect(d.passio).toEqual({});
  });

  it('mbta failure leaves passio stops intact', async () => {
    const d = await discover(cfg(), deps({
      mbtaCandidates: async () => { throw new Error('mbta'); },
      passioStatic: async (a) => (a === 'mit' ? passio('mit', ['m1'], ['m1']) : passio('ezride', [], [])),
    }));
    expect(d.stops.map((s) => s.id)).toEqual(['m1']);
    expect(d.stops[0]).toMatchObject({ source: 'mit', mode: 'shuttle', platformIds: ['m1'] });
    expect(d.routes.has('mit:r1')).toBe(true);
    expect(d.passio.mit).toBeDefined();
  });

  it('passio keeps only stops served by a trip', async () => {
    const d = await discover(cfg(), deps({
      passioStatic: async (a) => (a === 'mit' ? passio('mit', ['used', 'unused'], ['used']) : passio('ezride', [], [])),
    }));
    expect(d.stops.map((s) => s.id)).toEqual(['used']);
  });

  it('bikes limited to nearest 4 by walk time, with status url', async () => {
    const d = await discover(cfg(), deps({
      bikeInfo: async () => ({ info: bikeJson(6), statusUrl: 'https://status' }),
      walk: async (_o, t) => t.map((_, i) => 200 - i * 10),
    }));
    expect(d.bikes).toHaveLength(4);
    const secs = d.bikes.map((b) => b.walkSec);
    expect(secs).toEqual([...secs].sort((a, b) => a - b));
    expect(d.bikeStatusUrl).toBe('https://status');
  });

  it('caps walk targets at 500 and estimates the rest', async () => {
    const many = Array.from({ length: 600 }, (_, i) => stop(`s${i}`, 'subway', 0.0001 + i * 0.000001));
    const walk = vi.fn(async (_o: unknown, t: unknown[]) => t.map(() => 100));
    const d = await discover(cfg(), deps({ mbtaCandidates: async () => mbta(many), walk }));
    expect(walk.mock.calls[0][1]).toHaveLength(500);
    expect(d.stops).toHaveLength(600);
    expect(d.stops.filter((s) => s.walkEstimated)).toHaveLength(100);
  });
});
