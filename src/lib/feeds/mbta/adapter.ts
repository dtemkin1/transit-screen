import {
  alertsUrl, chunk, parseAlerts, parsePredictions, parseSchedules, parseStops, predictionsUrl, schedulesUrl, stopsUrl,
} from './api';
import type { Alert } from '../../types';
import type { Adapter, FeedScope, MbtaFeed } from '../types';

const SEC = 1000;
const MIN = 60 * SEC;

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
