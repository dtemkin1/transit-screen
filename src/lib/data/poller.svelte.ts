import type { Config } from '../../config';
import { lookupBuilding, type Building } from './building';
import type { Health } from '../board/health';
import { defaultDiscoveryDeps, discover, type Discovered } from './discovery';
import { adapterFor } from '../feeds';
import type { FeedConfig, FeedIO, FeedScope, FeedUpdate } from '../feeds/types';
import { isIndecent } from '../util/decency';
import { msUntilNext } from '../util/time';
import type { Alert, Departure, RouteInfo, Source, Station } from '../types';
import { fetchBytes, fetchJson, reportHiddenAlert } from './worker-client';

export interface PollerDeps {
  now(): number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  reload(): void;
  isOnline(): Promise<boolean>;
  fetchJson: typeof fetchJson;
  lookupBuilding(number: string): Promise<Building | null>;
  discover(cfg: Config): Promise<Discovered>;
  reportHiddenAlert(alert: Alert): void;
}

export interface PollerState {
  discovered?: Discovered;
  live: Record<Source, Departure[]>;
  scheduled: Record<Source, Departure[]>;
  health: Record<Source, Health>;
  alerts: Alert[];
  stations: Station[];
  extraRoutes: RouteInfo[];
  now: number;
  discoveryFailures: number;  // failed or empty discoveries in a row, before the first success
  name?: string;              // the building's name from the campus map, when looked up
  unknownBuilding?: boolean;  // the campus map has no building by the configured name
}

const SEC = 1000;
const MIN = 60 * SEC;
const TICK_MS = 5 * SEC;
const DISCOVERY_RETRY_MS = MIN;
const REDISCOVER_MS = 10 * MIN;
const RELOAD_HOUR = 4;
const RELOAD_RECHECK_MS = 5 * MIN;
const ONLINE_TIMEOUT_MS = 5 * SEC;

/** Routes, alerts and stations are unique per feed, not globally. */
const keyOf = (x: { source: Source; id: string }) => `${x.source}:${x.id}`;
const dedupeBy = <T>(items: T[], key: (t: T) => string): T[] => [...new Map(items.map((i) => [key(i), i])).values()];

export function createPoller(cfg: Config, overrides: Partial<PollerDeps> = {}) {
  const deps: PollerDeps = {
    now: () => Date.now(),
    setTimeout: ((...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a)) as typeof setTimeout,
    clearTimeout: ((id: Parameters<typeof clearTimeout>[0]) => globalThis.clearTimeout(id)) as typeof clearTimeout,
    reload: () => location.reload(),
    // Any HTTP response, even 404, proves the network path works.
    isOnline: () => fetch(cfg.workerUrl, { signal: AbortSignal.timeout(ONLINE_TIMEOUT_MS) }).then(() => true, () => false),
    fetchJson,
    lookupBuilding: (number) => lookupBuilding(cfg, number, fetchJson),
    discover: (c) => discover(c, defaultDiscoveryDeps(c)),
    reportHiddenAlert: (a) => reportHiddenAlert(cfg, a),
    ...overrides,
  };
  const io: FeedIO = { cfg, fetchJson: deps.fetchJson, fetchBytes };

  const perFeed = <T>(make: () => T): Record<Source, T> => Object.fromEntries(cfg.feeds.map((f) => [f.id, make()]));

  const state: PollerState = $state({
    discovered: undefined,
    live: perFeed<Departure[]>(() => []),
    scheduled: perFeed<Departure[]>(() => []),
    health: perFeed<Health>(() => ({ lastOk: null })),
    alerts: [],
    stations: [],
    extraRoutes: [],
    discoveryFailures: 0,
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

  const seconds = (v: unknown): number | undefined => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
  };

  // The feed's own timestamp (plus GBFS `ttl`) caps freshness, so a frozen feed doesn't read as live.
  const markOk = (source: Source, feedTimeSec?: unknown, validForSec?: unknown) => {
    const now = deps.now();
    const t = seconds(feedTimeSec);
    state.health[source] = { lastOk: t === undefined ? now : Math.min(now, (t + (seconds(validForSec) ?? 0)) * 1000) };
  };

  // Routes and alerts are kept per poll; state holds their deduped union.
  const routesByPoll = new Map<string, RouteInfo[]>();
  const reported = new Set<string>();  // hidden alerts already reported
  const alertsByPoll = new Map<string, Alert[]>();

  function apply(feed: FeedConfig, poll: string, u: FeedUpdate) {
    if (u.live) state.live[feed.id] = u.live;
    if (u.scheduled) state.scheduled[feed.id] = u.scheduled;
    if (u.routes) {
      routesByPoll.set(poll, u.routes);
      state.extraRoutes = dedupeBy([...routesByPoll.values()].flat(), keyOf);
    }
    if (u.alerts) {
      // Alerts are typed by people (Passio's by dispatchers), so screen them; the board can do without one.
      const clean = u.alerts.filter((a) => {
        if (!isIndecent(a.header)) return true;
        // Once per alert per page load: the poll repeats every 2 min.
        if (!reported.has(keyOf(a))) {
          reported.add(keyOf(a));
          console.warn(`poller: hid ${feed.name} alert ${a.id} for its wording`);
          deps.reportHiddenAlert(a);
        }
        return false;
      });
      alertsByPoll.set(poll, clean);
      state.alerts = dedupeBy([...alertsByPoll.values()].flat(), keyOf);
    }
    if (u.stations) {
      const fresh = new Map(u.stations.map((s) => [s.id, s]));
      state.stations = state.stations.map((s) => (s.source === feed.id ? fresh.get(s.id) ?? s : s));
    }
    if (u.fresh) markOk(feed.id, u.fresh.at, u.fresh.validFor);
  }

  const present = (d: Discovered, id: Source) =>
    id in d.feeds && (d.stops.some((s) => s.source === id) || d.stations.some((s) => s.source === id));

  const scopeOf = (d: Discovered, id: Source): FeedScope => ({
    data: d.feeds[id],
    stops: d.stops.filter((s) => s.source === id),
    stations: state.stations.filter((s) => s.source === id),
    routes: dedupeBy([...d.routes.values(), ...state.extraRoutes].filter((r) => r.source === id), keyOf),
  });

  // Every poll reads state.discovered when it runs, so a re-discovery is picked up on the next cycle.
  function startPolls() {
    for (const feed of cfg.feeds) {
      for (const poll of adapterFor(feed).polls(feed)) {
        const label = `${feed.name} ${poll.name}`;
        every(label, poll.everyMs, async () => {
          const d = state.discovered!;
          if (!present(d, feed.id)) return;
          const u = await poll.run(scopeOf(d, feed.id), io, deps.now());
          if (u) apply(feed, label, u);
        });
      }
    }
  }

  const size = (d: Discovered) => d.stops.length + d.stations.length;
  const isPartial = (d: Discovered) => cfg.feeds.some((f) => !(f.id in d.feeds));

  // Keeps last known station counts; a newly present feed starts fresh so it isn't "unavailable" before its first poll.
  function adopt(d: Discovered) {
    const old = new Map(state.stations.map((s) => [keyOf(s), s]));
    state.discovered = d;
    state.stations = d.stations.map((s) => ({ ...old.get(keyOf(s)), ...s }));
    for (const f of cfg.feeds) {
      if (present(d, f.id) && state.health[f.id].lastOk === null) markOk(f.id);
    }
  }

  let pollsStarted = false;

  // The configured building's position, looked up once; a failed lookup fails discovery, which retries.
  let located: Config | undefined = cfg.locate ? undefined : cfg;
  async function site(): Promise<Config> {
    if (located) return located;
    const b = await deps.lookupBuilding(cfg.building);
    state.unknownBuilding = b === null;
    if (!b) throw new Error(`building ${cfg.building} is not on the MIT campus map`);
    state.name = b.name;
    located = { ...cfg, location: { lat: b.lat, lon: b.lon } };
    return located;
  }

  async function discoverThenPoll() {
    if (!running) return;
    try {
      const d = await deps.discover(await site());
      if (!running) return;
      if (size(d) === 0) {
        console.warn('poller: discovery found nothing, retrying in 60 s');
        state.discoveryFailures++;
        after(DISCOVERY_RETRY_MS, discoverThenPoll);
        return;
      }
      const partial = isPartial(d);
      state.discoveryFailures = 0;
      adopt(d);
      if (!pollsStarted) {
        pollsStarted = true;
        startPolls();
      }
      if (partial) after(REDISCOVER_MS, rediscover);
    } catch (e) {
      console.warn('poller: discovery failed, retrying in 60 s', e);
      if (!state.discovered) state.discoveryFailures++;
      after(DISCOVERY_RETRY_MS, discoverThenPoll);
    }
  }

  /** Retries a partial discovery every 10 min; a smaller result never replaces the current one. */
  async function rediscover() {
    if (!running) return;
    try {
      const d = await deps.discover(await site());
      if (!running) return;
      if (size(d) >= size(state.discovered!)) adopt(d);
      if (isPartial(state.discovered!)) after(REDISCOVER_MS, rediscover);
    } catch (e) {
      console.warn('poller: re-discovery failed, retrying in 10 min', e);
      after(REDISCOVER_MS, rediscover);
    }
  }

  /** Reloads only when the Worker is reachable, so an offline kiosk keeps its last board instead of an error page. */
  async function reloadWhenOnline() {
    if (!running) return;
    let online = false;
    try {
      online = await deps.isOnline();
    } catch {
      online = false;
    }
    if (!running) return;
    if (online) deps.reload();
    else after(RELOAD_RECHECK_MS, reloadWhenOnline);
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
      after(msUntilNext(RELOAD_HOUR, deps.now()), reloadWhenOnline);
      discoverThenPoll();
    },
    stop() {
      running = false;
      for (const id of timers) deps.clearTimeout(id);
      timers.clear();
    },
  };
}
