import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseCsv } from './csv';
import { activeServiceIds, parseGtfsZip, scheduledDepartures, todaysService, type GtfsOptions } from './static';
import { fetchBytes, fetchJson, workerUrl } from '../../data/worker-client';
import { defaultConfig } from '../../../config';

const files: Record<string, string> = {
  'routes.txt': 'route_id,route_short_name,route_long_name,route_color,route_text_color\nr1,,Tech Shuttle,,\n',
  'stops.txt':
    'stop_id,stop_name,stop_lat,stop_lon\nA, Stop A,42.1,-71.1\nB,Stop B,42.2,-71.2\nC,Stop C,42.3,-71.3\nD, Stop D ,42.4,-71.4\n',
  'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id\nr1,WK,t1,,\nr1,WK,t2,,\n',
  'stop_times.txt': [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled',
    't1,07:30:00,07:30:00,A,1,0',
    't1,,,B,2,100',
    't1,,,C,3,200',
    't1,07:36:00,07:36:00,D,4,300',
    't2,25:10:00,25:10:00,A,1,0',
    't2,25:20:00,25:20:00,B,2,100',
  ].join('\r\n'),
  'calendar.txt':
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260101,20271231\n',
  'calendar_dates.txt': 'service_id,date,exception_type\nWK,20261126,2\n',
};
const toZip = (f: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, strToU8(v)])));
const MIT: GtfsOptions = { source: 'mit', mode: 'shuttle', color: '#A31F34' };
const EZ: GtfsOptions = { source: 'ezride', mode: 'bus', color: '#1F77B4', headsign: 'last-stop' };
const s = parseGtfsZip(toZip(files), MIT);

describe('parseGtfsZip', () => {
  it('interpolates blank times', () => {
    expect(s.stopTimes.get('t1')!.map((x) => x.dep)).toEqual(['07:30:00', '07:32:00', '07:34:00', '07:36:00']);
  });
  it('headsign falls back to last stop name', () => {
    expect(s.trips.get('t1')!.headsign).toBe('Stop D');
  });
  it('headsign "last-stop" ignores trip_headsign (EZRide uses it for the service name, "Evening Service")', () => {
    const ez = parseGtfsZip(toZip({
      ...files,
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id\nr1,WK,t1,Evening Service,\n',
    }), EZ);
    expect(ez.trips.get('t1')!.headsign).toBe('Stop D');
  });
  it('skips "out of service" routes and their trips (Passio publishes "OOS (out of service)")', () => {
    const oos = parseGtfsZip(toZip({
      ...files,
      'routes.txt': 'route_id,route_short_name,route_long_name,route_color,route_text_color\nr1,,Tech Shuttle,,\nr9,,OOS (out of service),FAFE01,D62728\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id\nr1,WK,t1,,\nr9,WK,t2,,\n',
    }), MIT);
    expect([...oos.routes.keys()]).toEqual(['r1']);
    expect(oos.trips.has('t2')).toBe(false);
  });
  it('MIT keeps a real trip_headsign', () => {
    const mit = parseGtfsZip(toZip({
      ...files,
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id\nr1,WK,t1,Kendall,\n',
    }), MIT);
    expect(mit.trips.get('t1')!.headsign).toBe('Kendall');
  });
  it('route uses long name and the default color of the feed', () => {
    expect(s.routes.get('r1')).toMatchObject({
      shortName: 'Tech Shuttle', color: '#A31F34', textColor: '#FFFFFF', source: 'mit', mode: 'shuttle',
    });
  });
  it('interpolates by stop_sequence when shape_dist is missing', () => {
    const p = parseGtfsZip(
      toZip({
        ...files,
        'stop_times.txt':
          'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,07:30:00,07:30:00,A,1\nt1,,,B,2\nt1,,,C,5\nt1,07:36:00,07:36:00,D,7\n',
      }),
      EZ,
    );
    expect(p.stopTimes.get('t1')!.map((x) => x.dep)).toEqual(['07:30:00', '07:31:00', '07:34:00', '07:36:00']);
    expect(p.routes.get('r1')!.color).toBe('#1F77B4');
  });
});

describe('activeServiceIds', () => {
  it('calendar_dates removes service', () => {
    expect(activeServiceIds(s, '20261126').size).toBe(0);
  });
  it('weekday service is active on a Tuesday and not on Saturday', () => {
    expect(activeServiceIds(s, '20261117').has('WK')).toBe(true);
    expect(activeServiceIds(s, '20261121').size).toBe(0);
  });
});

describe('todaysService', () => {
  it('lists each direction that boards at a nearby stop today', () => {
    expect(todaysService(s, new Set(['A']), '20261117')).toEqual([
      { key: 'r1:Stop B', routeId: 'r1' }, { key: 'r1:Stop D', routeId: 'r1' },
    ]);
  });
  it('leaves out service that does not run that day', () => {
    expect(todaysService(s, new Set(['A']), '20261121')).toEqual([]);
    expect(todaysService(s, new Set(['A']), '20261126')).toEqual([]);
  });
  it('does not count a stop where the trip only drops off', () => {
    expect(todaysService(s, new Set(['B']), '20261117')).toEqual([{ key: 'r1:Stop D', routeId: 'r1' }]);
  });
});

describe('scheduledDepartures', () => {
  it('25:10 trip appears at 01:05 next morning', () => {
    const deps = scheduledDepartures(s, new Set(['A']), Date.parse('2026-11-18T06:05:00Z'), 3600e3);
    expect(deps.map((d) => d.tripId)).toContain('t2');
  });
  it('uses Eastern time even if TZ=UTC', () => {
    const deps = scheduledDepartures(s, new Set(['A']), Date.parse('2026-11-17T12:00:00Z'), 3600e3);
    const t1 = deps.find((d) => d.tripId === 't1')!;
    expect(t1.departureTime).toBe(Date.parse('2026-11-17T12:30:00Z'));
    expect(t1).toMatchObject({
      live: false, directionKey: 'r1:Stop D', headsign: 'Stop D', source: 'mit', mode: 'shuttle',
    });
  });
  it('mergeRoutes gives two routes to one destination the same direction (EZRide\'s morning and evening shuttles)', () => {
    const two = {
      ...files,
      'routes.txt': 'route_id,route_short_name,route_long_name,route_color,route_text_color\nr1,EZRide,Evening Shuttle,,\nr2,,Morning Shuttle,,\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id\nr1,WK,t1,,\nr2,WK,t2,,\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,07:30:00,07:30:00,A,1\nt1,07:36:00,07:36:00,D,2\nt2,07:40:00,07:40:00,A,1\nt2,07:46:00,07:46:00,D,2\n',
    };
    const keys = (o: GtfsOptions) =>
      scheduledDepartures(parseGtfsZip(toZip(two), o), new Set(['A']), Date.parse('2026-11-17T12:00:00Z'), 3600e3)
        .map((d) => d.directionKey);
    expect(keys(EZ)).toEqual(['r1:Stop D', 'r2:Stop D']);
    expect(keys({ ...EZ, mergeRoutes: true })).toEqual(['Stop D', 'Stop D']);
  });
  it('excludes last stop of trip', () => {
    expect(scheduledDepartures(s, new Set(['D']), Date.parse('2026-11-17T12:00:00Z'), 3600e3)).toEqual([]);
  });
  describe('around the 03:00 service-day cutoff', () => {
    const early = parseGtfsZip(
      toZip({
        ...files,
        'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id\nr1,WK,t3,,\nr1,WK,t4,,\nr1,WK,t5,,\n',
        'stop_times.txt': [
          'trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled',
          't3,03:10:00,03:10:00,A,1,0', 't3,03:20:00,03:20:00,B,2,100',
          't4,00:30:00,00:30:00,A,1,0', 't4,00:40:00,00:40:00,B,2,100',
          't5,12:00:00,12:00:00,A,1,0', 't5,12:10:00,12:10:00,B,2,100',
        ].join('\n'),
      }),
      MIT,
    );
    const ids = (nowIso: string, win = 3600e3) =>
      scheduledDepartures(early, new Set(['A']), Date.parse(nowIso), win).map((d) => d.tripId);

    it('finds a 03:10 trip of the calendar date at 02:30', () => {
      expect(ids('2026-11-18T07:30:00Z')).toContain('t3');
    });
    it('finds a 00:30 trip of the calendar date at 00:20', () => {
      expect(ids('2026-11-18T05:20:00Z')).toContain('t4');
    });
    it('does not double-count a trip running on consecutive days', () => {
      const deps = scheduledDepartures(early, new Set(['A']), Date.parse('2026-11-17T09:00:00Z'), 48 * 3600e3);
      const keys = deps.map((d) => `${d.tripId}@${d.departureTime}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(deps.filter((d) => d.tripId === 't5')).toHaveLength(2);
    });
  });

  it('respects the window', () => {
    const deps = scheduledDepartures(s, new Set(['A']), Date.parse('2026-11-17T12:31:00Z'), 3600e3);
    expect(deps.map((d) => d.tripId)).not.toContain('t1');
  });
});

describe('parseCsv', () => {
  it('parses quoted csv with commas', () => {
    expect(parseCsv('a,b\r\n"x, y",z')).toEqual([{ a: 'x, y', b: 'z' }]);
  });
  it('strips BOM and handles escaped quotes', () => {
    expect(parseCsv('﻿a,b\n"say ""hi""",\n')).toEqual([{ a: 'say "hi"', b: '' }]);
  });
});

describe('worker-client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('workerUrl joins without doubling slashes', () => {
    expect(workerUrl({ ...defaultConfig, workerUrl: 'http://w/' }, '/x/y')).toBe('http://w/x/y');
    expect(workerUrl({ ...defaultConfig, workerUrl: 'http://w' }, 'x')).toBe('http://w/x');
  });
  it('fetchJson returns parsed body and throws on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"a":1}')));
    expect(await fetchJson<{ a: number }>('http://w/x')).toEqual({ a: 1 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('no', { status: 500 })));
    await expect(fetchJson('http://w/x')).rejects.toThrow();
  });
  it('fetchBytes returns bytes and throws on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(new Uint8Array([1, 2]))));
    expect(Array.from(await fetchBytes('http://w/x'))).toEqual([1, 2]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })));
    await expect(fetchBytes('http://w/x')).rejects.toThrow();
  });
  it('throws when headers arrive but the body stalls past the timeout', async () => {
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => {
      const body = new ReadableStream({
        start(ctrl) {
          init.signal!.addEventListener('abort', () => ctrl.error(new Error('aborted')));
        },
      });
      return Promise.resolve(new Response(body));
    });
    await expect(fetchJson('http://w/x', undefined, 20)).rejects.toThrow();
    await expect(fetchBytes('http://w/x', 20)).rejects.toThrow();
  });
  it('honors a caller-supplied signal', async () => {
    vi.stubGlobal(
      'fetch',
      (_u: string, init: RequestInit) =>
        new Promise((_, rej) => {
          init.signal!.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    );
    const own = new AbortController();
    const p = fetchJson('http://w/x', { signal: own.signal });
    own.abort();
    await expect(p).rejects.toThrow();
  });
  it('throws on timeout', async () => {
    vi.stubGlobal(
      'fetch',
      (_u: string, init: RequestInit) =>
        new Promise((_, rej) => {
          init.signal!.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    );
    await expect(fetchJson('http://w/x', undefined, 20)).rejects.toThrow();
    await expect(fetchBytes('http://w/x', 20)).rejects.toThrow();
  });
});
