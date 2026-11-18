import type { Config } from '../config';
import { applyStatus } from './bluebikes';
import type { Health } from './board/health';
import { defaultDiscoveryDeps, discover, type Discovered } from './discovery';
import { parseServiceAlerts, parseTripUpdates, passioRealtimeUrl } from './gtfs/passio-realtime';
import { scheduledDepartures } from './gtfs/passio-static';
import {
  alertsUrl, chunk, parseAlerts, parsePredictions, parseSchedules, predictionsUrl, schedulesUrl,
} from './mbta';
import { msUntilNext } from './time';
import type { Alert, BikeStation, Departure, RouteInfo, Source } from './types';
import { fetchJson } from './worker-client';

export interface PollerDeps {
  now(): number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  reload(): void;
  fetchJson: typeof fetchJson;
  discover(): Promise<Discovered>;
}

export interface PollerState {
  discovered?: Discovered;
  live: Record<Source, Departure[]>;
  scheduled: Record<Source, Departure[]>;
  health: Record<Source, Health>;
  alerts: Alert[];
  bikes: BikeStation[];
  extraRoutes: RouteInfo[];
  now: number;
}

const SEC = 1000;
const MIN = 60 * SEC;
const TICK_MS = 5 * SEC;
const DISCOVERY_RETRY_MS = MIN;
const PASSIO_SCHEDULE_MS = MIN;
const SCHEDULE_WINDOW_MS = 60 * MIN;
const RELOAD_HOUR = 4;

const PASSIO: ReadonlyArray<{ source: 'mit' | 'ezride'; agency: 'mit' | 'charlesriver' }> = [
  { source: 'mit', agency: 'mit' },
  { source: 'ezride', agency: 'charlesriver' },
];

const dedupe = <T extends { id: string }>(items: T[]): T[] =>
  [...new Map(items.map((i) => [i.id, i])).values()];

const dedupeRoutes = (routes: RouteInfo[]): RouteInfo[] =>
  [...new Map(routes.map((r) => [`${r.source}:${r.id}`, r])).values()];

const emptyBySource = <T>(make: () => T): Record<Source, T> =>
  ({ mbta: make(), mit: make(), ezride: make(), bluebikes: make() });

export function createPoller(cfg: Config, overrides: Partial<PollerDeps> = {}) {
  const deps: PollerDeps = {
    now: () => Date.now(),
    setTimeout: ((...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a)) as typeof setTimeout,
    clearTimeout: ((id: Parameters<typeof clearTimeout>[0]) => globalThis.clearTimeout(id)) as typeof clearTimeout,
    reload: () => location.reload(),
    fetchJson,
    discover: () => discover(cfg, defaultDiscoveryDeps(cfg)),
    ...overrides,
  };

  const state: PollerState = $state({
    discovered: undefined,
    live: emptyBySource<Departure[]>(() => []),
    scheduled: emptyBySource<Departure[]>(() => []),
    health: emptyBySource<Health>(() => ({ lastOk: null })),
    alerts: [],
    bikes: [],
    extraRoutes: [],
    now: deps.now(),
  });

  const timers = new Set<ReturnType<typeof setTimeout>>();
  let running = false;

  const after = (ms: number, fn: () => void | Promise<void>) => {
    const id = deps.setTimeout(() => {
      timers.delete(id);
      void fn();
    }, ms);
    timers.add(id);
  };

  /** Runs `fn` now, then again `ms` after each run finishes; failures are logged and never stop the loop. */
  const every = (label: string, ms: number, fn: () => Promise<void> | void) => {
    const run = async () => {
      if (!running) return;
      try {
        await fn();
      } catch (e) {
        console.warn(`poller: ${label} failed`, e);
      }
      if (running) after(ms, run);
    };
    void run();
  };

  const markOk = (source: Source) => {
    state.health[source] = { lastOk: deps.now() };
  };

  const get = <T>(url: string) => deps.fetchJson<T>(url);

  // Per-poll route lists; extraRoutes is their deduped union.
  let predictionRoutes: RouteInfo[] = [];
  let scheduleRoutes: RouteInfo[] = [];
  const publishRoutes = () => {
    state.extraRoutes = dedupeRoutes([...predictionRoutes, ...scheduleRoutes]);
  };

  const alertsBySource: Record<'mbta' | 'mit' | 'ezride', Alert[]> = { mbta: [], mit: [], ezride: [] };
  const publishAlerts = () => {
    state.alerts = [...alertsBySource.mbta, ...alertsBySource.mit, ...alertsBySource.ezride];
  };

  function startPolls(d: Discovered) {
    const platformIds = [...new Set(d.stops.filter((s) => s.source === 'mbta').flatMap((s) => s.platformIds))];

    if (platformIds.length > 0) {
      every('MBTA predictions', 20 * SEC, async () => {
        const now = deps.now();
        const parts = await Promise.all(
          chunk(platformIds, 100).map(async (ids) => parsePredictions(await get(predictionsUrl(cfg, ids)), now)),
        );
        state.live.mbta = parts.flatMap((p) => p.departures);
        predictionRoutes = dedupeRoutes(parts.flatMap((p) => p.routes));
        publishRoutes();
        markOk('mbta');
      });

      every('MBTA schedules', 10 * MIN, async () => {
        const now = deps.now();
        const parts = await Promise.all(
          chunk(platformIds, 100).map(async (ids) => parseSchedules(await get(schedulesUrl(cfg, ids, now)))),
        );
        state.scheduled.mbta = parts.flatMap((p) => p.departures);
        scheduleRoutes = dedupeRoutes(parts.flatMap((p) => p.routes));
        publishRoutes();
      });

      every('MBTA alerts', 2 * MIN, async () => {
        const routeIds = new Set<string>();
        for (const r of d.routes.values()) if (r.source === 'mbta') routeIds.add(r.id);
        for (const r of state.extraRoutes) if (r.source === 'mbta') routeIds.add(r.id);
        // MBTA ANDs route and stop filters, so each is its own request.
        const urls = [
          ...chunk([...routeIds], 100).map((ids) => alertsUrl(cfg, ids, [])),
          ...chunk(platformIds, 100).map((ids) => alertsUrl(cfg, [], ids)),
        ];
        const lists = await Promise.all(urls.map(async (u) => parseAlerts(await get(u))));
        alertsBySource.mbta = dedupe(lists.flat());
        publishAlerts();
      });
    }

    for (const { source, agency } of PASSIO) {
      const p = d.passio[source];
      if (!p) continue;
      const stopIds = new Set(d.stops.filter((s) => s.source === source).flatMap((s) => s.platformIds));

      every(`${source} trip updates`, 20 * SEC, async () => {
        const now = deps.now();
        const json = await get(passioRealtimeUrl(agency, 'tripUpdates'));
        state.live[source] = parseTripUpdates(json, p, stopIds, now);
        markOk(source);
      });

      every(`${source} scheduled`, PASSIO_SCHEDULE_MS, () => {
        state.scheduled[source] = scheduledDepartures(p, stopIds, deps.now(), SCHEDULE_WINDOW_MS);
      });

      every(`${source} alerts`, 2 * MIN, async () => {
        alertsBySource[source] = parseServiceAlerts(await get(passioRealtimeUrl(agency, 'serviceAlerts')), source);
        publishAlerts();
      });
    }

    if (d.bikeStatusUrl) {
      const url = d.bikeStatusUrl;
      every('BlueBikes status', 60 * SEC, async () => {
        state.bikes = applyStatus(d.bikes, await get(url));
        markOk('bluebikes');
      });
    }
  }

  function discoverThenPoll() {
    if (!running) return;
    deps.discover().then(
      (d) => {
        if (!running) return;
        state.discovered = d;
        state.bikes = d.bikes;
        startPolls(d);
      },
      (e) => {
        console.warn('poller: discovery failed, retrying in 60 s', e);
        after(DISCOVERY_RETRY_MS, discoverThenPoll);
      },
    );
  }

  return {
    get state() {
      return state;
    },
    start() {
      if (running) return;
      running = true;
      const tick = () => {
        state.now = deps.now();
        after(TICK_MS, tick);
      };
      after(TICK_MS, tick);
      after(msUntilNext(RELOAD_HOUR, deps.now()), () => deps.reload());
      discoverThenPoll();
    },
    stop() {
      running = false;
      for (const id of timers) deps.clearTimeout(id);
      timers.clear();
    },
  };
}
