import { parseServiceAlerts, parseTripUpdates } from './realtime';
import { directionKey, parseGtfsZip, scheduledDepartures, todaysService, type GtfsStatic } from './static';
import { serviceDate } from '../../util/time';
import type { Stop } from '../../types';
import { workerUrl } from '../../data/worker-client';
import type { Adapter, FeedScope, GtfsFeed, Poll } from '../types';

const SEC = 1000;
const MIN = 60 * SEC;
const SCHEDULE_WINDOW_MS = 60 * MIN;

/** Stops some trip boards at; a trip's last stop is drop-off only. */
function servedStops(p: GtfsStatic): Stop[] {
  const served = new Set<string>();
  for (const times of p.stopTimes.values()) for (const t of times) served.add(t.stopId);
  return [...p.stops.values()]
    .filter((s) => served.has(s.id))
    .map((s) => ({
      id: s.id, source: p.source, mode: p.mode, name: s.name, lat: s.lat, lon: s.lon,
      platformIds: [s.id], walkSec: 0, walkEstimated: false,
    }));
}

/** Stop ids each direction boards at. */
function serving(p: GtfsStatic): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [tripId, trip] of p.trips) {
    const key = directionKey(p, trip.routeId, trip.headsign);
    const set = out.get(key) ?? new Set<string>();
    for (const t of (p.stopTimes.get(tripId) ?? []).slice(0, -1)) set.add(t.stopId);
    out.set(key, set);
  }
  return out;
}

const stopIds = (scope: FeedScope) => new Set(scope.stops.flatMap((s) => s.platformIds));
const headerTime = (json: unknown) => (json as { header?: { timestamp?: unknown } } | null)?.header?.timestamp;

export const gtfs: Adapter<GtfsFeed, GtfsStatic> = {
  async candidates(feed, { cfg, fetchBytes }) {
    const p = parseGtfsZip(await fetchBytes(workerUrl(cfg, `/gtfs/${feed.id}`)), {
      source: feed.id, mode: feed.mode, color: feed.color, headsign: feed.headsign, mergeRoutes: !!feed.badge,
    });
    for (const [id, r] of p.routes) {
      p.routes.set(id, {
        ...r,
        ...(feed.badge && { badge: feed.badge.text, color: feed.badge.color, textColor: feed.badge.textColor }),
        ...(feed.named && { named: true }),
      });
    }
    return { data: p, stops: servedStops(p), routes: [...p.routes.values()], serving: serving(p) };
  },

  polls(feed) {
    const rt = feed.realtime;
    const polls: Poll<GtfsStatic>[] = [{
      name: 'schedule', everyMs: MIN,
      run: (scope, _io, nowMs) => ({
        scheduled: scheduledDepartures(scope.data, stopIds(scope), nowMs, SCHEDULE_WINDOW_MS),
        // With no live feed, the schedule is as current as this board can be.
        ...(!rt && { fresh: {} }),
      }),
    }, {
      name: 'service',
      // Repeats so a feed that joins on a later discovery is counted the same day.
      everyMs: 10 * MIN,
      run: (scope, _io, nowMs) => scope.stops.length === 0 ? undefined : {
        service: todaysService(scope.data, stopIds(scope), serviceDate(nowMs))
          .map((r) => ({ mode: feed.mode, ...r, stopId: '' })),
      },
    }];
    if (rt) {
      polls.push({
        name: 'trip updates', everyMs: 20 * SEC,
        async run(scope, { fetchJson }, nowMs) {
          const json = await fetchJson<unknown>(rt.tripUpdates);
          return { live: parseTripUpdates(json, scope.data, stopIds(scope), nowMs), fresh: { at: headerTime(json) } };
        },
      });
    }
    if (rt?.serviceAlerts) {
      const url = rt.serviceAlerts;
      polls.push({
        name: 'alerts', everyMs: 2 * MIN,
        run: async (_scope, { fetchJson }) => ({ alerts: parseServiceAlerts(await fetchJson(url), feed.id) }),
      });
    }
    return polls;
  },
};
