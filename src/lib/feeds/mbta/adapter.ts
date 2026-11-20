import {
  alertsUrl, chunk, parseAlerts, parsePredictions, parseSchedules, parseServiceDestinations, parseServiceRoutes,
  parseStops, predictionsUrl, routePatternsUrl, routesUrl, schedulesUrl, stopsUrl,
} from './api';
import { serviceDate } from '../../util/time';
import type { Alert } from '../../types';
import type { Adapter, FeedScope, MbtaFeed } from '../types';

const SEC = 1000;
const MIN = 60 * SEC;
const DIRECTIONS = [0, 1] as const;

const platformIds = (scope: FeedScope) => [...new Set(scope.stops.flatMap((s) => s.platformIds))];
const dedupe = (alerts: Alert[]) => [...new Map(alerts.map((a) => [a.id, a])).values()];

export const mbta: Adapter<MbtaFeed, null> = {
  async candidates(feed, { cfg, fetchJson }) {
    const modes = ['subway', 'bus'] as const;
    const docs = await Promise.all(modes.map((m) => fetchJson<unknown>(stopsUrl(cfg, m, feed.walkMin[m]))));
    return { data: null, stops: modes.flatMap((m, i) => parseStops(docs[i], m, feed.id)) };
  },

  polls(feed) {
    return [
      {
        name: 'predictions', everyMs: 20 * SEC,
        async run(scope, { cfg, fetchJson }) {
          const ids = platformIds(scope);
          if (ids.length === 0) return undefined;
          const parts = await Promise.all(
            chunk(ids).map(async (c) => parsePredictions(await fetchJson(predictionsUrl(cfg, c)), feed.id)));
          return { live: parts.flatMap((p) => p.departures), routes: parts.flatMap((p) => p.routes), fresh: {} };
        },
      },
      {
        name: 'schedules', everyMs: 10 * MIN,
        async run(scope, { cfg, fetchJson }, nowMs) {
          const ids = platformIds(scope);
          if (ids.length === 0) return undefined;
          const parts = await Promise.all(
            chunk(ids).map(async (c) => parseSchedules(await fetchJson(schedulesUrl(cfg, c, nowMs)), feed.id)));
          return { scheduled: parts.flatMap((p) => p.departures), routes: parts.flatMap((p) => p.routes) };
        },
      },
      {
        name: 'service',
        // Repeats so stops found on a later discovery are counted the same day.
        everyMs: 10 * MIN,
        async run(scope, { cfg, fetchJson }, nowMs) {
          if (scope.stops.length === 0) return undefined;
          const sd = serviceDate(nowMs);
          const busIds = scope.stops.filter((s) => s.mode === 'bus').flatMap((s) => s.platformIds);
          /** Bus rows are one per route direction, so each direction is asked about across all bus stops. */
          const bus = DIRECTIONS.flatMap((dir) => chunk(busIds).map(async (ids) =>
            parseServiceRoutes(await fetchJson(routesUrl(cfg, ids, sd, dir, 'bus')))
              .map((r) => ({ mode: r.mode, key: `${r.id}:${dir}`, routeId: r.id, stopId: '' }))));
          /** Subway rows are one per route and destination at each station, so each station is asked about alone. */
          const subway = scope.stops.filter((s) => s.mode === 'subway').map(async (s) =>
            parseServiceDestinations(await fetchJson(routePatternsUrl(cfg, s.platformIds, sd)))
              .map((r) => ({ mode: r.mode, key: `${r.id}:${r.headsign}`, routeId: r.id, stopId: s.id })));
          const rows = (await Promise.all([...bus, ...subway])).flat();
          return { service: [...new Map(rows.map((r) => [`${r.stopId}|${r.key}`, r])).values()] };
        },
      },
      {
        name: 'alerts', everyMs: 2 * MIN,
        async run(scope, { cfg, fetchJson }) {
          const ids = platformIds(scope);
          if (ids.length === 0) return undefined;
          const routeIds = [...new Set(scope.routes.map((r) => r.id))];
          // MBTA ANDs route and stop filters, so each is its own request.
          const urls = [
            ...chunk(routeIds).map((c) => alertsUrl(cfg, c, [])),
            ...chunk(ids).map((c) => alertsUrl(cfg, [], c)),
          ];
          const lists = await Promise.all(urls.map(async (u) => parseAlerts(await fetchJson(u), feed.id)));
          return { alerts: dedupe(lists.flat()) };
        },
      },
    ];
  },
};
