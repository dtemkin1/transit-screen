import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../config';
import type { Discovered } from './discovery';
import { createPoller, type PollerDeps } from './poller.svelte';
import type { BikeStation, RouteInfo, Stop } from './types';
import predictions from '../test/fixtures/mbta-predictions.json';
import schedules from '../test/fixtures/mbta-schedules.json';
import alerts from '../test/fixtures/mbta-alerts.json';
import stationStatus from '../test/fixtures/gbfs-station_status.json';

const cfg = { ...defaultConfig, workerUrl: 'https://w.example' };
// 2026-11-17 12:00 Eastern; next 04:00 Eastern is 16 h away.
const START = Date.parse('2026-11-17T12:00:00-05:00');
const STATUS_URL = 'https://gbfs.example/station_status.json';

const stop = (id: string, source: Stop['source'], platformIds: string[]): Stop => ({
  id, source, mode: source === 'mbta' ? 'subway' : 'shuttle', name: id, lat: 0, lon: 0,
  platformIds, walkSec: 60, walkEstimated: false,
});
const route = (id: string): RouteInfo => ({
  id, source: 'mbta', mode: 'subway', shortName: id, longName: id, color: '#000000', textColor: '#FFFFFF',
});
const bike = (id: string): BikeStation => ({ id, name: id, lat: 0, lon: 0, walkSec: 60 });

function discovered(over: Partial<Discovered> = {}): Discovered {
  return {
    stops: [stop('place-knncl', 'mbta', ['70071', '70072'])],
    bikes: [bike('a')],
    bikeStatusUrl: STATUS_URL,
    routes: new Map([['mbta:Red', route('Red')]]),
    passio: {},
    ...over,
  };
}

type Handler = (url: string) => unknown;

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
  const discover = vi.fn(disc);
  const poller = createPoller(cfg, {
    fetchJson: fetchJson as unknown as PollerDeps['fetchJson'],
    reload, discover,
  });
  const count = (sub: string) => calls.filter((u) => u.includes(sub)).length;
  return { poller, calls, count, reload, discover };
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('poller', () => {
  it('polls MBTA predictions every 20s', async () => {
    const h = harness(ok);
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.count('/mbta/predictions')).toBe(1);
    expect(h.poller.state.live.mbta.length).toBeGreaterThan(0);
    expect(h.poller.state.health.mbta.lastOk).toBe(START);
    expect(h.poller.state.extraRoutes.length).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(19_999);
    expect(h.count('/mbta/predictions')).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.count('/mbta/predictions')).toBe(2);
    await vi.advanceTimersByTimeAsync(20_000);
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
    expect(h.poller.state.bikes[0]).toMatchObject({ id: 'a' });

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
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.count('/mbta/predictions')).toBe(2);
    expect(h.poller.state.live.mbta).toHaveLength(before);
    expect(h.poller.state.health.mbta.lastOk).toBe(START);
    expect(console.warn).toHaveBeenCalled();
    fail = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.count('/mbta/predictions')).toBe(3);
    expect(h.poller.state.health.mbta.lastOk).toBe(START + 40_000);
    h.poller.stop();
  });

  it('one source throwing does not stop others', async () => {
    const h = harness({ ...ok, '/mbta/predictions': () => { throw new Error('down'); } });
    h.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.poller.state.health.mbta.lastOk).toBeNull();
    expect(h.poller.state.health.bluebikes.lastOk).toBe(START);
    expect(h.poller.state.scheduled.mbta.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.count(STATUS_URL)).toBe(2);
    expect(h.count('/mbta/predictions')).toBe(4);
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

  it('skips a Passio source whose static is missing and bikes without a status url', async () => {
    const h = harness(ok, async () => discovered({
      stops: [stop('place-knncl', 'mbta', ['70071']), stop('s1', 'mit', ['s1'])],
      bikeStatusUrl: undefined,
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
    await vi.advanceTimersByTimeAsync(20_000);
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
    const h = harness(ok);
    h.poller.start();
    await vi.advanceTimersByTimeAsync(16 * 3_600_000 - 1);
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
