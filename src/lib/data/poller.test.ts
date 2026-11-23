import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../config/resolve';
import { sourceStatus } from '../board/health';
import type { Discovered } from './discovery';
import type { GtfsStatic } from '../feeds/gtfs/static';
import { createPoller, type PollerDeps } from './poller.svelte';
import type { RouteInfo, Station, Stop } from '../types';
import predictions from '../../test/fixtures/mbta-predictions.json';
import schedules from '../../test/fixtures/mbta-schedules.json';
import alerts from '../../test/fixtures/mbta-alerts.json';
import stationStatus from '../../test/fixtures/gbfs-station_status.json';

const cfg = { ...defaultConfig, workerUrl: 'https://w.example' };
// 2026-11-17 12:00 Eastern; next 04:00 Eastern is 16 h away.
const START = Date.parse('2026-11-17T12:00:00-05:00');
// Reload tests start here instead: fast-forwarding 16 h runs the 20 s polls thousands of times,
// which takes about 5 s of real CPU and times out on a busy machine.
const BEFORE_4AM = Date.parse('2026-11-18T03:58:00-05:00');
const TO_4AM = 2 * 60_000;
const STATUS_URL = 'https://gbfs.example/station_status.json';

const stop = (id: string, source: Stop['source'], platformIds: string[]): Stop => ({
  id, source, mode: source === 'mbta' ? 'subway' : 'shuttle', name: id, lat: 0, lon: 0,
  platformIds, walkSec: 60, walkEstimated: false,
});
const route = (id: string): RouteInfo => ({
  id, source: 'mbta', mode: 'subway', shortName: id, longName: id, color: '#000000', textColor: '#FFFFFF',
});
const bike = (id: string): Station => ({
  id, source: 'bluebikes', mode: 'bikes', unit: { one: 'bike' }, name: id, lat: 0, lon: 0, walkSec: 60,
});
const MBTA_ONLY = { mbta: null };
const WITH_BIKES = { mbta: null, bluebikes: { statusUrl: STATUS_URL } };

function discovered(over: Partial<Discovered> = {}): Discovered {
  return {
    stops: [stop('place-knncl', 'mbta', ['70071', '70072'])],
    stations: [bike('a')],
    routes: new Map([['mbta:Red', route('Red')]]),
    serving: new Map(),
    feeds: WITH_BIKES,
    ...over,
  };
}

type Handler = (url: string) => unknown;

/** Every poller a test starts is stopped afterwards, so one failing test can't leak timers into the next. */
const started: { stop(): void }[] = [];

function harness(handlers: Record<string, Handler | unknown>, disc: () => Promise<Discovered> = async () => discovered()) {
  const calls: string[] = [];
  const fetchJson = vi.fn(async (url: string) => {
    calls.push(url);
    const key = Object.keys(handlers).find((k) => url.includes(k));
    if (!key) throw new Error(`no fake for ${url}`);
    const h = handlers[key];
    return typeof h === 'function' ? (h as Handler)(url) : h;
  });
  const reload = vi.fn();
  const online = { value: true };
  const isOnline = vi.fn(async () => online.value);
  const discover = vi.fn(disc);
  const reportHiddenAlert = vi.fn();
  const poller = createPoller(cfg, {
    fetchJson: fetchJson as unknown as PollerDeps['fetchJson'],
    reload, discover, isOnline, reportHiddenAlert,
  });
  started.push(poller);
  const count = (sub: string) => calls.filter((u) => u.includes(sub)).length;
  return { poller, calls, count, reload, discover, isOnline, online, reportHiddenAlert };
}

const ok = {
  '/mbta/predictions': predictions,
  '/mbta/schedules': schedules,
  '/mbta/alerts': alerts,
  [STATUS_URL]: stationStatus,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  for (const p of started.splice(0)) p.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('poller', () => {
  it('polls MBTA predictions every 15s', async () => {
    const h = harness(ok);
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.count('/mbta/predictions')).toBe(1);
    expect(h.poller.state.live.mbta.length).toBeGreaterThan(0);
    expect(h.poller.state.health.mbta.lastOk).toBe(START);
    expect(h.poller.state.extraRoutes.length).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(h.count('/mbta/predictions')).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.count('/mbta/predictions')).toBe(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.count('/mbta/predictions')).toBe(3);
    h.poller.stop();
  });

  it('uses the other intervals and fetches alerts by route and by stop separately', async () => {
    const h = harness(ok);
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.count('/mbta/schedules')).toBe(1);
    expect(h.count('/mbta/alerts')).toBe(2);
    const alertUrls = h.calls.filter((u) => u.includes('/mbta/alerts'));
    expect(alertUrls.some((u) => u.includes('filter[route]=') && !u.includes('filter[stop]'))).toBe(true);
    expect(alertUrls.some((u) => u.includes('filter[stop]=70071,70072') && !u.includes('filter[route]'))).toBe(true);
    expect(h.count(STATUS_URL)).toBe(1);
    expect(h.poller.state.stations[0]).toMatchObject({ id: 'a' });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.count(STATUS_URL)).toBe(2);
    expect(h.count('/mbta/alerts')).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.count('/mbta/alerts')).toBe(4);
    expect(h.count('/mbta/schedules')).toBe(1);
    await vi.advanceTimersByTimeAsync(8 * 60_000);
    expect(h.count('/mbta/schedules')).toBe(2);
    h.poller.stop();
  });

  it('keeps each feed\'s service rows for sizing, asked again every 10 min', async () => {
    const red = {
      data: [{ id: 'Red-1-0', type: 'route_pattern', relationships: {
        route: { data: { id: 'Red', type: 'route' } }, representative_trip: { data: { id: 't', type: 'trip' } } } }],
      included: [{ id: 'Red', type: 'route', attributes: { type: 1 } }, { id: 't', type: 'trip', attributes: { headsign: 'Ashmont' } }],
    };
    const h = harness({ ...ok, '/mbta/route_patterns': red });
    expect(h.poller.state.service).toEqual({});
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.poller.state.service.mbta).toEqual([
      { mode: 'subway', key: 'Red:Ashmont', routeId: 'Red', stopId: 'place-knncl' },
    ]);
    expect(h.count('/mbta/route_patterns')).toBe(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.count('/mbta/route_patterns')).toBe(2);
  });

  it('holds a live time steady while its prediction moves by less than 30 s', async () => {
    let at = '2026-11-17T12:04:00-05:00';
    const doc = () => ({
      data: [{ id: 'p', type: 'prediction', attributes: { departure_time: at, direction_id: 0, schedule_relationship: null },
        relationships: { route: { data: { id: 'Red', type: 'route' } }, trip: { data: { id: 't1', type: 'trip' } },
          stop: { data: { id: '70071', type: 'stop' } } } }],
      included: [{ id: 'Red', type: 'route', attributes: { type: 1, long_name: 'Red Line', color: 'DA291C', text_color: 'FFFFFF' } }],
    });
    const h = harness({ ...ok, '/mbta/predictions': doc });
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    at = '2026-11-17T12:04:10-05:00';
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.poller.state.live.mbta[0].departureTime).toBe(Date.parse('2026-11-17T12:04:00-05:00'));
  });

  it('keeps the trips live predictions mark cancelled, replacing them each poll', async () => {
    const cancelledDoc = (trip: string) => ({ data: [{ id: 'p', type: 'prediction',
      attributes: { departure_time: null, direction_id: 1, schedule_relationship: 'CANCELLED' },
      relationships: { route: { data: { id: 'Red', type: 'route' } }, trip: { data: { id: trip, type: 'trip' } },
        stop: { data: { id: '70072', type: 'stop' } } } }] });
    let trip = 'a';
    const h = harness({ ...ok, '/mbta/predictions': () => cancelledDoc(trip) });
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.poller.state.cancelled.mbta).toEqual([{ tripId: 'a', stopId: '70072', directionKey: 'Red:1' }]);
    trip = 'b';
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.poller.state.cancelled.mbta).toEqual([{ tripId: 'b', stopId: '70072', directionKey: 'Red:1' }]);
  });

  it('dedupes merged alerts by id', async () => {
    const h = harness(ok);
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    const ids = h.poller.state.alerts.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    h.poller.stop();
  });

  it('chunks platform ids at 100 per request', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `p${i}`);
    const h = harness(ok, async () => discovered({ stops: [stop('big', 'mbta', ids)] }));
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.count('/mbta/predictions')).toBe(2);
    expect(h.count('/mbta/schedules')).toBe(2);
    h.poller.stop();
  });

  it('fetch error keeps previous data and lastOk', async () => {
    let fail = false;
    const h = harness({ ...ok, '/mbta/predictions': (): unknown => { if (fail) throw new Error('boom'); return predictions; } });
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    const before = h.poller.state.live.mbta.length;
    expect(before).toBeGreaterThan(0);
    fail = true;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.count('/mbta/predictions')).toBe(2);
    expect(h.poller.state.live.mbta).toHaveLength(before);
    expect(h.poller.state.health.mbta.lastOk).toBe(START);
    expect(console.warn).toHaveBeenCalled();
    fail = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.count('/mbta/predictions')).toBe(3);
    expect(h.poller.state.health.mbta.lastOk).toBe(START + 30_000);
    h.poller.stop();
  });

  it('one source throwing does not stop others', async () => {
    const h = harness({ ...ok, '/mbta/predictions': () => { throw new Error('down'); } });
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    // Seeded when polls start, never advanced by the failing poll.
    expect(h.poller.state.health.mbta.lastOk).toBe(START);
    expect(h.poller.state.health.bluebikes.lastOk).toBe(START);
    expect(h.poller.state.scheduled.mbta.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.count(STATUS_URL)).toBe(2);
    expect(h.count('/mbta/predictions')).toBe(5);
    h.poller.stop();
  });

  it('schedules and alerts failures do not touch health', async () => {
    const h = harness({
      ...ok,
      '/mbta/schedules': () => { throw new Error('x'); },
      '/mbta/alerts': () => { throw new Error('x'); },
    });
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.poller.state.health.mbta.lastOk).toBe(START);
    h.poller.stop();
  });

  it('seeds lastOk at the start time for polled sources only, before any poll succeeds', async () => {
    const h = harness({}, async () => discovered({ feeds: MBTA_ONLY }));
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.poller.state.discovered).toBeDefined();
    expect(h.poller.state.health.mbta.lastOk).toBe(START);
    expect(h.poller.state.health.bluebikes.lastOk).toBeNull();
    expect(h.poller.state.health.mit.lastOk).toBeNull();
    expect(h.poller.state.health.ezride.lastOk).toBeNull();
    h.poller.stop();
  });

  it('skips a feed that failed discovery (no GTFS static, no GBFS status url)', async () => {
    const h = harness(ok, async () => discovered({
      stops: [stop('place-knncl', 'mbta', ['70071']), stop('s1', 'mit', ['s1'])],
      feeds: MBTA_ONLY,
    }));
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls.some((u) => u.includes('passio3.com'))).toBe(false);
    expect(h.count(STATUS_URL)).toBe(0);
    h.poller.stop();
  });

  it('does not poll until discovery succeeds; retries after 60s', async () => {
    let attempts = 0;
    const h = harness(ok, async () => {
      if (++attempts === 1) throw new Error('nope');
      return discovered();
    });
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.count('/mbta/predictions')).toBe(0);
    expect(h.poller.state.discovered).toBeUndefined();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(h.discover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.discover).toHaveBeenCalledTimes(2);
    expect(h.count('/mbta/predictions')).toBe(1);
    expect(h.poller.state.discovered).toBeDefined();
    h.poller.stop();
  });

  it('does not overlap runs of the same poll', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = harness({ ...ok, '/mbta/predictions': async () => { await gate; return predictions; } });
    h.poller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.count('/mbta/predictions')).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.count('/mbta/predictions')).toBe(2);
    h.poller.stop();
  });

  it('ticks now every 5s', async () => {
    const h = harness(ok);
    h.poller.start();
    expect(h.poller.state.now).toBe(START);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.poller.state.now).toBe(START + 5_000);
    h.poller.stop();
  });

  it('schedules reload at next 04:00 Eastern', async () => {
    vi.setSystemTime(BEFORE_4AM);
    const h = harness(ok);
    h.poller.start();
    await vi.advanceTimersByTimeAsync(TO_4AM - 1);
    expect(h.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.reload).toHaveBeenCalledTimes(1);
    h.poller.stop();
  });

  it('stop() clears every timer', async () => {
    const h = harness(ok);
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    h.poller.stop();
    expect(vi.getTimerCount()).toBe(0);
    const n = h.calls.length;
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(h.calls.length).toBe(n);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('stop() during an in-flight poll does not reschedule', async () => {
    const h = harness({ ...ok, '/mbta/predictions': async () => new Promise(() => {}) });
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    h.poller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

const mitStatic: GtfsStatic = {
  source: 'mit', mode: 'shuttle', mergeRoutes: false,
  stops: new Map(['s1', 's2', 's3'].map((id) => [id, { id, name: id, lat: 0, lon: 0 }])),
  routes: new Map([['R1', { id: 'R1', source: 'mit', mode: 'shuttle', shortName: 'R1', longName: 'Route 1', color: '#000000', textColor: '#FFFFFF' }]]),
  trips: new Map([['t1', { routeId: 'R1', serviceId: 'svc', headsign: 'Kendall' }]]),
  stopTimes: new Map([['t1', [
    { stopId: 's1', seq: 1, dep: '12:30:00' }, { stopId: 's2', seq: 2, dep: '12:40:00' }, { stopId: 's3', seq: 3, dep: '12:50:00' },
  ]]]),
  calendar: new Map([['svc', {
    days: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, true])),
    start: '20260101', end: '20261231',
  }]]),
  calendarDates: [],
};
const mitDiscovered = () => discovered({
  stops: [stop('place-knncl', 'mbta', ['70071']), stop('s1', 'mit', ['s1'])],
  feeds: { ...WITH_BIKES, mit: mitStatic },
});
const tripUpdates = {
  entity: [{ trip_update: {
    trip: { trip_id: 't1' },
    stop_time_update: [{ stop_id: 's1', departure: { time: String((START + 10 * 60_000) / 1000) } }],
  } }],
};
const serviceAlerts = { entity: [{ id: 'm1', alert: { header_text: { translation: [{ text: 'Shuttle detour' }] } } }] };

describe('Passio polling', () => {
  const passioOk = { ...ok, tripUpdates, serviceAlerts };

  it('polls tripUpdates every 20s into live.mit and health.mit', async () => {
    const h = harness(passioOk, async () => mitDiscovered());
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.count('tripUpdates')).toBe(1);
    expect(h.poller.state.live.mit).toHaveLength(1);
    expect(h.poller.state.live.mit[0]).toMatchObject({ source: 'mit', routeId: 'R1', stopId: 's1', live: true });
    expect(h.poller.state.health.mit.lastOk).toBe(START);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.count('tripUpdates')).toBe(2);
    expect(h.poller.state.health.mit.lastOk).toBe(START + 20_000);
    expect(h.count('ezride') + h.count('charlesriver')).toBe(0);
    h.poller.stop();
  });

  it('recomputes scheduled.mit from the static feed every 60s', async () => {
    const h = harness(passioOk, async () => mitDiscovered());
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = h.poller.state.scheduled.mit;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ source: 'mit', stopId: 's1', live: false, tripId: 't1' });
    // 12:30 departure drops out of the window start once time passes it.
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    expect(h.poller.state.scheduled.mit).toHaveLength(0);
    h.poller.stop();
  });

  it('merges serviceAlerts into state.alerts every 2 min', async () => {
    const h = harness(passioOk, async () => mitDiscovered());
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.count('serviceAlerts')).toBe(1);
    expect(h.poller.state.alerts.some((a) => a.source === 'mit' && a.header === 'Shuttle detour')).toBe(true);
    expect(h.poller.state.alerts.some((a) => a.source === 'mbta')).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.count('serviceAlerts')).toBe(2);
    h.poller.stop();
  });

  it('drops an alert whose wording is profane, keeps the others, and reports it once', async () => {
    const typed = { entity: [
      { id: 'ok', alert: { header_text: { translation: [{ text: 'Shuttle detour' }] } } },
      { id: 'bad', alert: { header_text: { translation: [{ text: 'sh1t, the shuttle is late' }] } } },
    ] };
    const h = harness({ ...passioOk, serviceAlerts: typed }, async () => mitDiscovered());
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    const mit = h.poller.state.alerts.filter((a) => a.source === 'mit').map((a) => a.id);
    expect(mit).toEqual(['ok']);
    expect(console.warn).toHaveBeenCalledWith('poller: hid MIT Shuttles alert bad for its wording');
    expect(h.reportHiddenAlert).toHaveBeenCalledWith(expect.objectContaining({ source: 'mit', id: 'bad' }));
    expect(h.poller.state.live.mit).toHaveLength(1);
    // The next alerts poll sees it again: still hidden, not reported again.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.count('serviceAlerts')).toBe(2);
    expect(h.reportHiddenAlert).toHaveBeenCalledTimes(1);
    h.poller.stop();
  });

  it('a tripUpdates error keeps previous live.mit and lastOk', async () => {
    let fail = false;
    const h = harness({ ...passioOk, tripUpdates: (): unknown => { if (fail) throw new Error('x'); return tripUpdates; } },
      async () => mitDiscovered());
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    fail = true;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.count('tripUpdates')).toBe(2);
    expect(h.poller.state.live.mit).toHaveLength(1);
    expect(h.poller.state.health.mit.lastOk).toBe(START);
    h.poller.stop();
  });
});

describe('frozen feed timestamps', () => {
  it('Passio: health follows header.timestamp, not fetch success', async () => {
    const frozen = { ...tripUpdates, header: { timestamp: String(START / 1000) } };
    const h = harness({ ...ok, tripUpdates: frozen, serviceAlerts }, async () => mitDiscovered());
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.poller.state.health.mit.lastOk).toBe(START);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(h.count('tripUpdates')).toBeGreaterThan(10);
    expect(h.poller.state.health.mit.lastOk).toBe(START);
    h.poller.stop();
  });

  it('Passio: a future timestamp is capped at now', async () => {
    const h = harness({ ...ok, tripUpdates: { ...tripUpdates, header: { timestamp: String(START / 1000 + 3600) } }, serviceAlerts },
      async () => mitDiscovered());
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.poller.state.health.mit.lastOk).toBe(START);
    h.poller.stop();
  });

  it('BlueBikes: health follows last_updated + ttl (GBFS data is current until then)', async () => {
    const frozen = { ...stationStatus, last_updated: START / 1000 - 100, ttl: 60 };
    const h = harness({ ...ok, [STATUS_URL]: frozen });
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.poller.state.health.bluebikes.lastOk).toBe(START - 40_000);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(h.poller.state.health.bluebikes.lastOk).toBe(START - 40_000);
    h.poller.stop();
  });

  it('BlueBikes: a healthy feed served a minute late by its CDN stays "ok" between polls', async () => {
    // Lyft regenerates every ~60 s (ttl 60) and its CDN serves a copy for up to ~60 s more,
    // so a fetched document's last_updated can be ~2 min old. With 60 s polls that must not read as delayed.
    const h = harness({
      ...ok,
      [STATUS_URL]: () => ({ ...stationStatus, last_updated: Math.floor(Date.now() / 1000) - 115, ttl: 60 }),
    });
    h.poller.start();
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(59_000);
      expect(sourceStatus(h.poller.state.health.bluebikes, Date.now(), false)).toBe('ok');
      await vi.advanceTimersByTimeAsync(1_000);
    }
    h.poller.stop();
  });
});

describe('discovery recovery', () => {
  const full = () => discovered({
    stops: [stop('place-knncl', 'mbta', ['70071']), stop('s1', 'mit', ['s1'])],
    stations: [bike('a'), bike('b')],
    feeds: { ...WITH_BIKES, mit: mitStatic, ezride: { ...mitStatic, source: 'ezride' }, longwood: { ...mitStatic, source: 'longwood' } },
  });

  it('retries an empty discovery after 60s and starts polls once non-empty', async () => {
    let n = 0;
    const h = harness(ok, async () => (++n === 1 ? discovered({ stops: [], stations: [], feeds: MBTA_ONLY }) : discovered()));
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.poller.state.discovered).toBeUndefined();
    expect(h.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.discover).toHaveBeenCalledTimes(2);
    expect(h.count('/mbta/predictions')).toBe(1);
    h.poller.stop();
  });

  it('counts failed or empty discoveries so the screen can say so, and resets on success', async () => {
    let n = 0;
    const h = harness(ok, async () => {
      n++;
      if (n === 1) throw new Error('worker down');
      if (n === 2) return discovered({ stops: [], stations: [], feeds: MBTA_ONLY });
      return discovered();
    });
    expect(h.poller.state.discoveryFailures).toBe(0);
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.poller.state.discoveryFailures).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.poller.state.discoveryFailures).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.poller.state.discoveryFailures).toBe(0);
    expect(h.poller.state.discovered).toBeDefined();
    h.poller.stop();
  });

  it('re-discovers a partial result after 10 min and swaps in the fuller one', async () => {
    let n = 0;
    const h = harness({ ...ok, tripUpdates, serviceAlerts }, async () => (++n === 1 ? discovered({ feeds: MBTA_ONLY }) : full()));
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.count(STATUS_URL)).toBe(0);
    expect(h.poller.state.discovered?.feeds.mit).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.discover).toHaveBeenCalledTimes(2);
    expect(h.poller.state.discovered?.feeds.mit).toBeDefined();
    expect(h.poller.state.stations.map((b) => b.id)).toEqual(['a', 'b']);
    // Existing loops pick up the new discovery on their next run.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.count(STATUS_URL)).toBeGreaterThan(0);
    expect(h.poller.state.health.mit.lastOk).not.toBeNull();
    expect(h.poller.state.health.bluebikes.lastOk).not.toBeNull();
    // Complete now: no further re-discovery.
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(h.discover).toHaveBeenCalledTimes(2);
    h.poller.stop();
  });

  it('seeds lastOk for a source that becomes pollable after a swap, keeping existing ones', async () => {
    let n = 0;
    const h = harness({}, async () => (++n === 1 ? discovered({ feeds: MBTA_ONLY }) : full()));
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.poller.state.health.bluebikes.lastOk).toBeNull();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.discover).toHaveBeenCalledTimes(2);
    expect(h.poller.state.health.bluebikes.lastOk).toBe(START + 10 * 60_000);
    expect(h.poller.state.health.mit.lastOk).toBe(START + 10 * 60_000);
    // mbta was already seeded and every poll since has failed: it is not refreshed by the swap.
    expect(h.poller.state.health.mbta.lastOk).toBe(START);
    h.poller.stop();
  });

  it('ignores a smaller re-discovery result and keeps retrying', async () => {
    let n = 0;
    const first = discovered({ feeds: MBTA_ONLY });
    const h = harness(ok, async () => (++n === 1 ? first : discovered({ stops: [], stations: [bike('a')], feeds: MBTA_ONLY })));
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.discover).toHaveBeenCalledTimes(2);
    expect(h.poller.state.discovered?.stops).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.discover).toHaveBeenCalledTimes(3);
    h.poller.stop();
  });
});

describe('error resilience', () => {
  it('retries initial discovery after 60s when processing the result throws, starting polls once', async () => {
    let n = 0;
    const h = harness(ok, async () => (++n === 1
      ? { ...discovered(), stops: null as unknown as Stop[] }
      : discovered()));
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.count('/mbta/predictions')).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.discover).toHaveBeenCalledTimes(2);
    expect(h.count('/mbta/predictions')).toBe(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.count('/mbta/predictions')).toBe(2);
    h.poller.stop();
  });

  it('re-discovery throwing continues the 10 min chain', async () => {
    let n = 0;
    const h = harness(ok, async () => {
      n++;
      if (n === 2) throw new Error('flaky');
      if (n === 3) return { ...discovered(), stops: null as unknown as Stop[] };
      return discovered({ feeds: MBTA_ONLY });
    });
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.discover).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.discover).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.discover).toHaveBeenCalledTimes(4);
    h.poller.stop();
  });
});

describe('building lookup', () => {
  const STATA = { number: '32', name: 'Ray and Maria Stata Center', lat: 42.3616, lon: -71.0906 };

  function located(lookup: PollerDeps['lookupBuilding']) {
    const lookupBuilding = vi.fn(lookup);
    const discover = vi.fn(async (_c: typeof cfg) => discovered());
    const poller = createPoller({ ...cfg, building: '32', name: '', locate: true }, {
      fetchJson: (async () => { throw new Error('offline'); }) as unknown as PollerDeps['fetchJson'],
      lookupBuilding, discover, reload: vi.fn(), isOnline: async () => true,
    });
    started.push(poller);
    return { poller, lookupBuilding, discover };
  }

  it('discovers from the building\'s position and shows its name, looking it up once', async () => {
    const h = located(async () => STATA);
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.discover.mock.calls[0][0].location).toEqual({ lat: STATA.lat, lon: STATA.lon });
    expect(h.poller.state.name).toBe('Ray and Maria Stata Center');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.discover).toHaveBeenCalledTimes(2);
    expect(h.lookupBuilding).toHaveBeenCalledTimes(1);
  });

  it('a building the campus map does not know stops discovery and says so; it keeps retrying', async () => {
    const h = located(async () => null);
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.poller.state.unknownBuilding).toBe(true);
    expect(h.discover).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.lookupBuilding).toHaveBeenCalledTimes(2);
  });

  it('a failed lookup counts as a failed discovery, and the next success clears it', async () => {
    let n = 0;
    const h = located(async () => { if (++n === 1) throw new Error('worker down'); return STATA; });
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.poller.state.discoveryFailures).toBe(1);
    expect(h.poller.state.unknownBuilding).toBeFalsy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.poller.state.discoveryFailures).toBe(0);
    expect(h.poller.state.discovered).toBeDefined();
  });

  it('a board with a fixed location never looks anything up', async () => {
    const lookupBuilding = vi.fn(async () => STATA);
    const discover = vi.fn(async (_c: typeof cfg) => discovered());
    const poller = createPoller(cfg, {
      fetchJson: (async () => { throw new Error('offline'); }) as unknown as PollerDeps['fetchJson'],
      lookupBuilding, discover, reload: vi.fn(), isOnline: async () => true,
    });
    started.push(poller);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(lookupBuilding).not.toHaveBeenCalled();
    expect(discover.mock.calls[0][0].location).toEqual(cfg.location);
  });
});

describe('reload reachability', () => {
  it('reloads at 04:00 when online', async () => {
    vi.setSystemTime(BEFORE_4AM);
    const h = harness(ok);
    h.poller.start();
    await vi.advanceTimersByTimeAsync(TO_4AM);
    expect(h.isOnline).toHaveBeenCalledTimes(1);
    expect(h.reload).toHaveBeenCalledTimes(1);
    h.poller.stop();
  });

  it('while offline, re-checks every 5 min and reloads once online', async () => {
    vi.setSystemTime(BEFORE_4AM);
    const h = harness(ok);
    h.online.value = false;
    h.poller.start();
    await vi.advanceTimersByTimeAsync(TO_4AM);
    expect(h.isOnline).toHaveBeenCalledTimes(1);
    expect(h.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(h.isOnline).toHaveBeenCalledTimes(2);
    expect(h.reload).not.toHaveBeenCalled();
    h.online.value = true;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(h.reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(h.reload).toHaveBeenCalledTimes(1);
    h.poller.stop();
  });
});
