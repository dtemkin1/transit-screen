import { describe, expect, it } from 'vitest';
import { buildBoard, type BoardInput } from './build';
import type { Discovered } from '../discovery';
import type { Alert, BikeStation, BoardPanel, Departure, Mode, RouteInfo, Source, Stop } from '../types';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const stop = (source: Source, mode: Mode, id: string, walkSec: number, platformIds = [id]): Stop => ({
  id, source, mode, name: `Stop ${id}`, lat: 0, lon: 0, platformIds, walkSec, walkEstimated: false,
});
const route = (source: Source, mode: Mode, id: string, longName = id): RouteInfo => ({
  id, source, mode, shortName: id, longName, color: '#000000', textColor: '#FFFFFF',
});

const STOPS: Stop[] = [
  stop('mbta', 'subway', 'place-cntsq', 840, ['70069', '70070']),
  stop('mbta', 'subway', 'place-knncl', 600, ['70071', '70072']),
  stop('mbta', 'bus', '1001', 120),
  stop('mbta', 'bus', '1002', 200),
  stop('ezride', 'ezride', 'e1', 300),
  stop('mit', 'shuttle', 'm1', 100),
];
const ROUTES = [
  route('mbta', 'subway', 'Red', 'Red Line'),
  route('mbta', 'bus', '1'),
  route('mbta', 'bus', '64'),
  route('ezride', 'ezride', 'er'),
  route('mit', 'shuttle', 'tech'),
];
const BIKE: BikeStation = { id: 'b1', name: 'Bikes', lat: 0, lon: 0, walkSec: 60 };

function discovered(bikes: BikeStation[] = []): Discovered {
  return {
    stops: STOPS, bikes, passio: {},
    routes: new Map(ROUTES.map((r) => [`${r.source}:${r.id}`, r])),
  };
}

interface DepOpts { min: number; dir?: string; headsign?: string; trip?: string; live?: boolean }
const dep = (source: Source, mode: Mode, routeId: string, stopId: string) =>
  (o: DepOpts): Departure => ({
    source, mode, routeId, stopId,
    directionKey: `${routeId}:${o.dir ?? '0'}`,
    headsign: o.headsign ?? 'Alewife',
    departureTime: NOW + o.min * MIN,
    live: o.live ?? true,
    tripId: o.trip,
  });
const red = (stopId: string, o: DepOpts) => dep('mbta', 'subway', 'Red', stopId)(o);
const bus1 = (stopId: string, o: DepOpts) => dep('mbta', 'bus', '1', stopId)({ headsign: 'Harvard', ...o });

const empty = (): Record<Source, Departure[]> => ({ mbta: [], mit: [], ezride: [], bluebikes: [] });

function input(over: Partial<BoardInput> = {}): BoardInput {
  return {
    discovered: discovered(), nowMs: NOW,
    live: empty(), scheduled: empty(),
    health: { mbta: { lastOk: NOW }, mit: { lastOk: NOW }, ezride: { lastOk: NOW }, bluebikes: { lastOk: NOW } },
    alerts: [], hide: [], extraRoutes: [],
    ...over,
  };
}
const withLive = (mbta: Departure[], rest: Partial<Record<Source, Departure[]>> = {}) => ({ ...empty(), mbta, ...rest });
const panel = (panels: BoardPanel[], id: string) => panels.find((p) => p.id === id);
const mins = (times: { departureTime: number }[]) => times.map((t) => (t.departureTime - NOW) / MIN);

describe('buildBoard: subway', () => {
  it('subway grouped by station, title "Red Line" when one route', () => {
    const { panels } = buildBoard(input({
      live: withLive([
        red('70069', { min: 20 }),
        red('70071', { min: 15 }),
        red('70072', { min: 18, dir: '1', headsign: 'Ashmont' }),
        red('70071', { min: 25 }),
      ]),
    }));
    const p = panel(panels, 'subway')!;
    expect(p.title).toBe('Red Line');
    expect(p.status).toBe('ok');
    // Sorted by walk: Kendall (600 s) before Central (840 s).
    expect(p.groups.map((g) => g.header)).toEqual([
      { name: 'Stop place-knncl', walkMin: 10 },
      { name: 'Stop place-cntsq', walkMin: 14 },
    ]);
    const kendall = p.groups[0];
    expect(kendall.rows.map((r) => r.key)).toEqual(['Red:Alewife', 'Red:Ashmont']);
    expect(mins(kendall.rows[0].times)).toEqual([15, 25]);
    expect(kendall.rows[0].times[0]).toMatchObject({ label: '15 min', live: true, reachable: true });
    expect(kendall.rows[0].stopName).toBeUndefined();
  });

  it('title "Subway" when more than one route is shown', () => {
    const green = route('mbta', 'subway', 'Green-E', 'Green Line E');
    const { panels } = buildBoard(input({
      extraRoutes: [green],
      live: withLive([red('70071', { min: 5 }), dep('mbta', 'subway', 'Green-E', '70072')({ min: 9 })]),
    }));
    expect(panel(panels, 'subway')!.title).toBe('Subway');
  });

  it('unreachable departure flagged, at most one leading unreachable time', () => {
    // Kendall walk is 600 s: 2 and 5 min are unreachable.
    const { panels } = buildBoard(input({
      live: withLive([2, 5, 12, 20, 30].map((min) => red('70071', { min }))),
    }));
    const times = panel(panels, 'subway')!.groups[0].rows[0].times;
    expect(mins(times)).toEqual([2, 12, 20]);
    expect(times.map((t) => t.reachable)).toEqual([false, true, true]);
  });

  it('a departure exactly at walk time is reachable', () => {
    const { panels } = buildBoard(input({ live: withLive([red('70071', { min: 10 })]) }));
    expect(panel(panels, 'subway')!.groups[0].rows[0].times[0].reachable).toBe(true);
  });

  it('drops departures outside the 60-minute window', () => {
    const { panels } = buildBoard(input({
      live: withLive([red('70071', { min: -1 }), red('70071', { min: 61 }), red('70071', { min: 30 })]),
    }));
    expect(mins(panel(panels, 'subway')!.groups[0].rows[0].times)).toEqual([30]);
  });
});

describe('buildBoard: staleness and merge', () => {
  it('stale live falls back to scheduled, status schedule-fallback', () => {
    const { panels } = buildBoard(input({
      health: { ...input().health, mbta: { lastOk: NOW - 11 * MIN } },
      live: withLive([red('70071', { min: 12 })]),
      scheduled: withLive([red('70071', { min: 14, live: false })]),
    }));
    const p = panel(panels, 'subway')!;
    expect(p.status).toBe('schedule-fallback');
    const times = p.groups[0].rows[0].times;
    expect(mins(times)).toEqual([14]);
    expect(times[0].live).toBe(false);
  });

  it('stale live with no schedule shows nothing', () => {
    const { panels } = buildBoard(input({
      health: { ...input().health, mbta: { lastOk: null } },
      live: withLive([red('70071', { min: 12 })]),
    }));
    expect(panel(panels, 'subway')).toBeUndefined();
  });

  it('delayed source still shows live times', () => {
    const { panels } = buildBoard(input({
      health: { ...input().health, mbta: { lastOk: NOW - 3 * MIN } },
      live: withLive([red('70071', { min: 12 })]),
      scheduled: withLive([red('70071', { min: 14, live: false })]),
    }));
    const p = panel(panels, 'subway')!;
    expect(p.status).toBe('delayed');
    expect(mins(p.groups[0].rows[0].times)).toEqual([12]);
  });

  it('live wins per (stop, direction); scheduled fills directions without live', () => {
    const { panels } = buildBoard(input({
      live: withLive([red('70071', { min: 12 })]),
      scheduled: withLive([
        red('70071', { min: 20, live: false }),
        red('70072', { min: 22, dir: '1', headsign: 'Ashmont', live: false }),
      ]),
    }));
    const rows = panel(panels, 'subway')!.groups[0].rows;
    expect(rows.map((r) => [r.key, mins(r.times), r.times[0].live])).toEqual([
      ['Red:Alewife', [12], true],
      ['Red:Ashmont', [22], false],
    ]);
  });

  it('scheduled departure within 2 min of a live one for the same trip is dropped', () => {
    // The live prediction for trip t1 has already left (outside the window), so the
    // key falls back to schedule — but t1's scheduled copy must not reappear.
    const { panels } = buildBoard(input({
      live: withLive([red('70071', { min: -1, trip: 't1' })]),
      scheduled: withLive([
        red('70071', { min: 0.5, trip: 't1', live: false }),
        red('70071', { min: 15, trip: 't2', live: false }),
      ]),
    }));
    expect(mins(panel(panels, 'subway')!.groups[0].rows[0].times)).toEqual([15]);
  });
});

describe('buildBoard: bus and shuttle', () => {
  it('bus row uses closest stop serving the direction', () => {
    const { panels } = buildBoard(input({
      live: withLive([
        bus1('1002', { min: 8 }),
        bus1('1001', { min: 9 }),
        bus1('1001', { min: 19 }),
        bus1('1002', { min: 10, dir: '1', headsign: 'Dudley' }),
        bus1('1001', { min: -2, dir: '1', headsign: 'Dudley' }), // past: 1001 does not serve dir 1 in window
      ]),
    }));
    const p = panel(panels, 'bus')!;
    expect(p.title).toBe('Buses');
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0].header).toBeUndefined();
    const rows = p.groups[0].rows;
    expect(rows.map((r) => [r.key, r.headsign, r.stopName, r.walkMin, mins(r.times)])).toEqual([
      ['mbta:1:0', 'Harvard', 'Stop 1001', 2, [9, 19]],
      ['mbta:1:1', 'Dudley', 'Stop 1002', 4, [10]],
    ]);
  });

  it('bus rows sorted by first reachable departure; mbta and ezride share the panel', () => {
    const { panels } = buildBoard(input({
      live: withLive(
        [
          bus1('1001', { min: 1 }),  // unreachable (walk 120 s)
          bus1('1001', { min: 12 }),
          dep('mbta', 'bus', '64', '1002')({ min: 7, headsign: 'Oak Sq' }),
        ],
        { ezride: [dep('ezride', 'ezride', 'er', 'e1')({ min: 6, headsign: 'North Station' })] },
      ),
    }));
    const rows = panel(panels, 'bus')!.groups[0].rows;
    expect(rows.map((r) => r.key)).toEqual(['ezride:er:0', 'mbta:64:0', 'mbta:1:0']);
    expect(rows[2].times.map((t) => t.reachable)).toEqual([false, true]);
  });

  it('bus panel status is the worst of mbta and ezride', () => {
    const { panels } = buildBoard(input({
      health: { ...input().health, ezride: { lastOk: NOW - 3 * MIN } },
      live: withLive([bus1('1001', { min: 9 })]),
    }));
    expect(panel(panels, 'bus')!.status).toBe('delayed');
  });

  it('shuttle panel titled "MIT Shuttles"', () => {
    const { panels } = buildBoard(input({
      live: withLive([], { mit: [dep('mit', 'shuttle', 'tech', 'm1')({ min: 4, headsign: 'Kendall' })] }),
    }));
    const p = panel(panels, 'shuttle')!;
    expect(p.title).toBe('MIT Shuttles');
    expect(p.groups[0].rows[0]).toMatchObject({ key: 'mit:tech:0', stopName: 'Stop m1', walkMin: 2 });
  });

  it('empty shuttle panel omitted', () => {
    const { panels } = buildBoard(input({ live: withLive([red('70071', { min: 12 })]) }));
    expect(panels.map((p) => p.id)).toEqual(['subway']);
  });
});

describe('buildBoard: filtering', () => {
  it('hidden route dropped (bare or source-qualified id)', () => {
    const live = withLive([bus1('1001', { min: 9 }), red('70071', { min: 12 })]);
    expect(buildBoard(input({ live, hide: ['1'] })).panels.map((p) => p.id)).toEqual(['subway']);
    expect(buildBoard(input({ live, hide: ['mbta:Red'] })).panels.map((p) => p.id)).toEqual(['bus']);
    expect(buildBoard(input({ live, hide: ['ezride:1'] })).panels.map((p) => p.id)).toEqual(['subway', 'bus']);
  });

  it('departure at unknown stop dropped', () => {
    const { panels } = buildBoard(input({ live: withLive([red('99999', { min: 12 })]) }));
    expect(panels).toEqual([]);
  });

  it('stop matching is per source', () => {
    // 'e1' is an EZRide stop; an MBTA departure claiming that id is unknown.
    const { panels } = buildBoard(input({ live: withLive([bus1('e1', { min: 9 })]) }));
    expect(panels).toEqual([]);
  });

  it('departure on unknown route dropped; extraRoutes make it known', () => {
    const live = withLive([dep('mbta', 'bus', '47', '1001')({ min: 9 })]);
    expect(buildBoard(input({ live })).panels).toEqual([]);
    const extra = route('mbta', 'bus', '47');
    const rows = panel(buildBoard(input({ live, extraRoutes: [extra] })).panels, 'bus')!.groups[0].rows;
    expect(rows[0].route).toEqual(extra);
  });
});

describe('buildBoard: bikes and order', () => {
  it('bikes panel present iff stations discovered, after the others', () => {
    const live = withLive([red('70071', { min: 12 }), bus1('1001', { min: 9 })], {
      mit: [dep('mit', 'shuttle', 'tech', 'm1')({ min: 4 })],
    });
    const { panels } = buildBoard(input({ live, discovered: discovered([BIKE]) }));
    expect(panels.map((p) => p.id)).toEqual(['subway', 'bus', 'shuttle', 'bikes']);
    expect(panel(panels, 'bikes')).toEqual({ id: 'bikes', title: 'BlueBikes', status: 'ok', groups: [] });

    const stale = buildBoard(input({
      discovered: discovered([BIKE]),
      health: { ...input().health, bluebikes: { lastOk: NOW - 11 * MIN } },
    }));
    expect(stale.panels).toEqual([{ id: 'bikes', title: 'BlueBikes', status: 'unavailable', groups: [] }]);

    expect(buildBoard(input()).panels).toEqual([]);
  });
});

describe('buildBoard: alerts', () => {
  const alert = (id: string, source: Source, routeIds: string[], stopIds: string[] = []): Alert =>
    ({ id, source, header: id, routeIds, stopIds });

  it('elevator alert absent; Red Line DELAY alert shown when Red on board', () => {
    const alerts = [
      alert('red-delay', 'mbta', ['Red']),
      alert('elevator-elsewhere', 'mbta', [], ['place-pktrm']),
      alert('red-delay', 'mbta', ['Red']), // duplicate
    ];
    const live = withLive([red('70071', { min: 12 })]);
    expect(buildBoard(input({ live, alerts })).alerts.map((a) => a.id)).toEqual(['red-delay']);
    expect(buildBoard(input({ alerts })).alerts).toEqual([]);
  });

  it('matches shown stops and platforms', () => {
    const alerts = [
      alert('station', 'mbta', [], ['place-knncl']),
      alert('platform', 'mbta', [], ['70072']),
      alert('far-station', 'mbta', [], ['place-cntsq']),
    ];
    const live = withLive([red('70071', { min: 12 })]);
    expect(buildBoard(input({ live, alerts })).alerts.map((a) => a.id)).toEqual(['station', 'platform']);
  });

  it('matches per source', () => {
    // EZRide route 'Red' and stop '70071' are not the MBTA ones.
    const alerts = [alert('ez-red', 'ezride', ['Red'], ['70071'])];
    const live = withLive([red('70071', { min: 12 })]);
    expect(buildBoard(input({ live, alerts })).alerts).toEqual([]);
  });

  it('agency-wide Passio alerts shown when that agency is on the board', () => {
    const alerts = [alert('mit-wide', 'mit', []), alert('ez-wide', 'ezride', [])];
    const live = withLive([], { mit: [dep('mit', 'shuttle', 'tech', 'm1')({ min: 4 })] });
    expect(buildBoard(input({ live, alerts })).alerts.map((a) => a.id)).toEqual(['mit-wide']);
  });
});
