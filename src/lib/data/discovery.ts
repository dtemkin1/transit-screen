import type { Config } from '../../config';
import { adapterFor, walkLimits } from '../feeds';
import type { FeedCandidates, FeedConfig } from '../feeds/types';
import { candidateRadiusM, fallbackWalkSec, haversineM } from '../util/geo';
import type { LatLon, RouteInfo, Source, Station, Stop } from '../types';
import { fetchBytes, fetchJson, workerUrl } from './worker-client';

export interface Discovered {
  stops: Stop[];
  stations: Station[];
  /** Keyed `${source}:${routeId}`. */
  routes: Map<string, RouteInfo>;
  /** `${source}:${directionKey}` → each `${source}:${stopId}` it boards at. */
  serving: Map<string, Set<string>>;
  /** The adapter data of each feed that discovered. */
  feeds: Record<Source, unknown>;
}

export interface DiscoveryDeps {
  candidates(feed: FeedConfig): Promise<FeedCandidates>;
  walk(origin: LatLon, targets: LatLon[]): Promise<(number | null)[]>;
}

/** The Worker's /walk endpoint accepts at most this many targets per call. */
const MAX_WALK_TARGETS = 500;

type Candidate = Stop | Station;

async function settled<T>(label: string, p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    console.warn(`discovery: ${label} failed`, e);
    return undefined;
  }
}

async function walkTimes(
  cfg: Config, deps: DiscoveryDeps, candidates: Candidate[],
): Promise<{ secs: (number | null)[]; estimated: boolean[] }> {
  const origin = cfg.location;
  const n = candidates.length;
  if (n === 0) return { secs: [], estimated: [] };

  const order = candidates
    .map((c, i) => ({ i, d: haversineM(origin, c) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_WALK_TARGETS)
    .map((x) => x.i);

  const secs: (number | null)[] = candidates.map((c) => fallbackWalkSec(origin, c, cfg));
  const estimated: boolean[] = candidates.map(() => true);
  try {
    const result = await deps.walk(origin, order.map((i) => ({ lat: candidates[i].lat, lon: candidates[i].lon })));
    order.forEach((idx, k) => {
      secs[idx] = result[k] ?? null;
      estimated[idx] = false;
    });
  } catch (e) {
    console.warn('discovery: walk failed, using straight-line estimates', e);
  }
  return { secs, estimated };
}

export async function discover(cfg: Config, deps: DiscoveryDeps): Promise<Discovered> {
  const results = await Promise.all(cfg.feeds.map((f) => settled(f.name, deps.candidates(f))));

  const routes = new Map<string, RouteInfo>();
  const serving = new Map<string, Set<string>>();
  const feeds: Discovered['feeds'] = {};
  const candidates: Candidate[] = [];
  const limitMin = new Map<Candidate, number>();
  cfg.feeds.forEach((feed, i) => {
    const c = results[i];
    if (!c) return;
    feeds[feed.id] = c.data;
    for (const r of c.routes ?? []) routes.set(`${feed.id}:${r.id}`, r);
    for (const [dir, ids] of c.serving ?? []) serving.set(`${feed.id}:${dir}`, new Set([...ids].map((id) => `${feed.id}:${id}`)));
    const limits = walkLimits(feed);
    for (const x of [...(c.stops ?? []), ...(c.stations ?? [])]) {
      const max = limits[x.mode];
      if (max === undefined || cfg.hide.includes(x.id)) continue;
      if (haversineM(cfg.location, x) > candidateRadiusM(max, cfg)) continue;
      candidates.push(x);
      limitMin.set(x, max);
    }
  });

  const { secs, estimated } = await walkTimes(cfg, deps, candidates);

  const stops: Stop[] = [];
  const stations: Station[] = [];
  candidates.forEach((c, i) => {
    const sec = secs[i];
    const pinned = cfg.pin.includes(c.id);
    if (sec === null && !pinned) return;
    const walkSec = sec ?? fallbackWalkSec(cfg.location, c, cfg);
    if (!pinned && walkSec > limitMin.get(c)! * 60) return;
    if ('platformIds' in c) stops.push({ ...c, walkSec, walkEstimated: estimated[i] || sec === null });
    else stations.push({ ...c, walkSec });
  });

  // Nearest stations first, up to each feed's maxStations.
  stations.sort((a, b) => a.walkSec - b.walkSec);
  const kept = cfg.feeds.flatMap((f) => {
    const own = stations.filter((s) => s.source === f.id);
    return 'maxStations' in f ? own.slice(0, f.maxStations) : own;
  });

  return { stops, stations: kept, routes, serving, feeds };
}

export function defaultDiscoveryDeps(cfg: Config): DiscoveryDeps {
  return {
    candidates: (feed) => adapterFor(feed).candidates(feed, { cfg, fetchJson, fetchBytes }),
    async walk(origin, targets) {
      const res = await fetchJson<{ seconds: (number | null)[] }>(workerUrl(cfg, '/walk'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origin, targets }),
      });
      return res.seconds;
    },
  };
}
