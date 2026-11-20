import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { defaultConfig } from '../../config/resolve';
import { gtfs } from './adapter';
import type { GtfsFeed } from '../types';

const zip = zipSync(Object.fromEntries(Object.entries({
  'routes.txt': 'route_id,route_short_name,route_long_name,route_color,route_text_color\nr1,,Evening Shuttle,91268E,FFFFFF\n',
  'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,Stop A,42.1,-71.1\nB,Stop B,42.2,-71.2\nZ,Unused,42.3,-71.3\n',
  'trips.txt': 'route_id,service_id,trip_id,trip_headsign\nr1,WK,t1,Evening Service\n',
  'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,07:00:00,07:00:00,A,1\nt1,07:10:00,07:10:00,B,2\n',
  'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,1,1,20260101,20271231\n',
}).map(([k, v]) => [k, strToU8(v)])));

const cfg = { ...defaultConfig, workerUrl: 'https://w.example' };
const feed: GtfsFeed = {
  kind: 'gtfs', id: 'ezride', name: 'EZRide', mode: 'bus', walkMin: 6, color: '#1F77B4',
  badge: { text: 'EZ', color: '#1F77B4', textColor: '#FFFFFF' }, headsign: 'last-stop',
};

async function candidates(f: GtfsFeed = feed) {
  const fetchBytes = vi.fn(async () => zip);
  const c = await gtfs.candidates(f, { cfg, fetchJson: vi.fn() as never, fetchBytes });
  return { c, fetchBytes };
}

describe('gtfs adapter', () => {
  it('fetches the static zip from the Worker under the feed id', async () => {
    const { fetchBytes } = await candidates();
    expect(fetchBytes).toHaveBeenCalledWith('https://w.example/gtfs/ezride');
  });

  it('keeps only stops some trip boards at, in the feed\'s mode', async () => {
    const { c } = await candidates();
    expect(c.stops!.map((s) => s.id)).toEqual(['A', 'B']);
    expect(c.stops![0]).toMatchObject({ source: 'ezride', mode: 'bus', platformIds: ['A'] });
  });

  it('records where each direction boards, leaving out the drop-off-only last stop', async () => {
    const { c } = await candidates({ ...feed, badge: undefined });
    expect(c.serving).toEqual(new Map([['r1:Stop B', new Set(['A'])]]));
  });

  it('keys directions by destination alone when every route shares the badge', async () => {
    const { c } = await candidates();
    expect(c.serving).toEqual(new Map([['Stop B', new Set(['A'])]]));
  });

  it('gives every route the feed\'s badge, and marks named feeds', async () => {
    const { c } = await candidates();
    expect(c.routes![0]).toMatchObject({ badge: 'EZ', color: '#1F77B4', textColor: '#FFFFFF' });
    expect(c.routes![0].named).toBeUndefined();
    const named = await candidates({ ...feed, badge: undefined, named: true });
    expect(named.c.routes![0]).toMatchObject({ named: true, color: '#91268E' });
    expect(named.c.routes![0].badge).toBeUndefined();
  });

  it('polls live data only when the feed has a realtime URL; a schedule-only feed counts as fresh', async () => {
    const rt = { ...feed, realtime: { tripUpdates: 'https://x/tu.json', serviceAlerts: 'https://x/sa.json' } };
    expect(gtfs.polls(feed).map((p) => p.name)).toEqual(['schedule', 'service']);
    expect(gtfs.polls(rt).map((p) => p.name)).toEqual(['schedule', 'service', 'trip updates', 'alerts']);

    const { c } = await candidates();
    const scope = { data: c.data, stops: c.stops!, stations: [], routes: c.routes! };
    const io = { cfg, fetchJson: vi.fn() as never, fetchBytes: vi.fn() };
    const now = Date.parse('2026-11-17T06:30:00-05:00');
    const scheduleOnly = await gtfs.polls(feed)[0].run(scope, io, now);
    expect(scheduleOnly).toMatchObject({ fresh: {} });
    expect(scheduleOnly!.scheduled).toHaveLength(1);
    expect(await gtfs.polls(rt)[0].run(scope, io, now)).not.toHaveProperty('fresh');
  });

  it('lists today\'s directions at nearby stops for sizing, every 10 minutes', async () => {
    const poll = gtfs.polls(feed).find((p) => p.name === 'service')!;
    expect(poll.everyMs).toBe(600_000);
    const { c } = await candidates();
    const scope = { data: c.data, stops: c.stops!.filter((s) => s.id === 'A'), stations: [], routes: c.routes! };
    const io = { cfg, fetchJson: vi.fn() as never, fetchBytes: vi.fn() };
    const u = await poll.run(scope, io, Date.parse('2026-11-17T06:30:00-05:00'));
    expect(u).toEqual({ service: [{ mode: 'bus', key: 'Stop B', routeId: 'r1', stopId: '' }] });
  });
});
