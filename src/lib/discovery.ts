import type { Config } from '../config';
import { candidateRadiusM, fallbackWalkSec, haversineM } from './geo';
import { GBFS_AUTODISCOVERY, parseStationInfo, resolveFeedUrls } from './bluebikes';
import { parsePassioZip, type PassioStatic } from './gtfs/passio-static';
import { fetchMbtaCandidates, type MbtaCandidates } from './mbta';
import type { BikeStation, LatLon, Mode, RouteInfo, Stop } from './types';
import { fetchBytes, fetchJson, workerUrl } from './worker-client';

export interface Discovered {
  stops: Stop[];
  bikes: BikeStation[];
  bikeStatusUrl?: string;
  routes: Map<string, RouteInfo>;
  passio: { mit?: PassioStatic; ezride?: PassioStatic };
}

export interface DiscoveryDeps {
  mbtaCandidates(cfg: Config): Promise<MbtaCandidates>;
  passioStatic(agency: 'mit' | 'charlesriver'): Promise<PassioStatic>;
  bikeInfo(): Promise<{ info: unknown; statusUrl: string }>;
  walk(origin: LatLon, targets: LatLon[]): Promise<(number | null)[]>;
}

/** The Worker's /walk endpoint accepts at most this many targets per call. */
const MAX_WALK_TARGETS = 500;

type Candidate =
  | { kind: 'stop'; stop: Stop }
  | { kind: 'bike'; bike: BikeStation };

const posOf = (c: Candidate): LatLon => (c.kind === 'stop' ? c.stop : c.bike);
const idOf = (c: Candidate): string => (c.kind === 'stop' ? c.stop.id : c.bike.id);
const modeOf = (c: Candidate): Mode => (c.kind === 'stop' ? c.stop.mode : 'bikes');

async function settled<T>(label: string, p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    console.warn(`discovery: ${label} failed`, e);
    return undefined;
  }
}

function passioStops(p: PassioStatic): Stop[] {
  const served = new Set<string>();
  for (const times of p.stopTimes.values()) for (const t of times) served.add(t.stopId);
  return [...p.stops.values()]
    .filter((s) => served.has(s.id))
    .map((s) => ({
      id: s.id, source: p.source, mode: p.mode, name: s.name, lat: s.lat, lon: s.lon,
      platformIds: [s.id], walkSec: 0, walkEstimated: false,
    }));
}

async function walkTimes(
  cfg: Config, deps: DiscoveryDeps, candidates: Candidate[],
): Promise<{ secs: (number | null)[]; estimated: boolean[] }> {
  const origin = cfg.location;
  const estimate = (c: Candidate) => fallbackWalkSec(origin, posOf(c), cfg);
  const n = candidates.length;
  if (n === 0) return { secs: [], estimated: [] };

  const order = candidates
    .map((c, i) => ({ i, d: haversineM(origin, posOf(c)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_WALK_TARGETS)
    .map((x) => x.i);

  const secs: (number | null)[] = candidates.map(estimate);
  const estimated: boolean[] = candidates.map(() => true);
  try {
    const result = await deps.walk(origin, order.map((i) => posOf(candidates[i])));
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
  const [mbta, mit, ezride, bike] = await Promise.all([
    settled('MBTA', deps.mbtaCandidates(cfg)),
    settled('Passio mit', deps.passioStatic('mit')),
    settled('Passio charlesriver', deps.passioStatic('charlesriver')),
    settled('BlueBikes', deps.bikeInfo()),
  ]);

  const routes = new Map<string, RouteInfo>();
  const passio: Discovered['passio'] = {};
  const stops: Stop[] = [];
  if (mbta) {
    for (const [k, r] of mbta.routes) routes.set(k, r);
    stops.push(...mbta.subway, ...mbta.bus);
  }
  for (const p of [mit, ezride]) {
    if (!p) continue;
    passio[p.source] = p;
    for (const r of p.routes.values()) routes.set(`${p.source}:${r.id}`, r);
    stops.push(...passioStops(p));
  }

  const origin = cfg.location;
  const candidates: Candidate[] = [];
  for (const stop of stops) {
    if (cfg.hide.includes(stop.id)) continue;
    if (haversineM(origin, stop) <= candidateRadiusM(cfg.modes[stop.mode].maxWalkMin, cfg)) {
      candidates.push({ kind: 'stop', stop });
    }
  }
  if (bike) {
    const radius = candidateRadiusM(cfg.modes.bikes.maxWalkMin, cfg);
    for (const b of parseStationInfo(bike.info, origin, radius)) {
      if (!cfg.hide.includes(b.id)) candidates.push({ kind: 'bike', bike: b });
    }
  }

  const { secs, estimated } = await walkTimes(cfg, deps, candidates);

  const keptStops: Stop[] = [];
  const keptBikes: BikeStation[] = [];
  candidates.forEach((c, i) => {
    const sec = secs[i];
    const pinned = cfg.pin.includes(idOf(c));
    if (sec === null && !pinned) return;
    const walkSec = sec ?? fallbackWalkSec(origin, posOf(c), cfg);
    if (!pinned && walkSec > cfg.modes[modeOf(c)].maxWalkMin * 60) return;
    if (c.kind === 'stop') {
      keptStops.push({ ...c.stop, walkSec, walkEstimated: estimated[i] || sec === null });
    } else {
      keptBikes.push({ ...c.bike, walkSec });
    }
  });

  const maxStations = cfg.modes.bikes.maxStations ?? keptBikes.length;
  const bikes = keptBikes.sort((a, b) => a.walkSec - b.walkSec).slice(0, maxStations);

  return { stops: keptStops, bikes, bikeStatusUrl: bike?.statusUrl, routes, passio };
}

export function defaultDiscoveryDeps(cfg: Config): DiscoveryDeps {
  return {
    mbtaCandidates: fetchMbtaCandidates,
    async passioStatic(agency) {
      const bytes = await fetchBytes(workerUrl(cfg, `/passio/${agency}/gtfs.zip`));
      return parsePassioZip(bytes, agency === 'mit' ? 'mit' : 'ezride', agency === 'mit' ? 'shuttle' : 'ezride');
    },
    async bikeInfo() {
      const { stationInformation, stationStatus } = resolveFeedUrls(await fetchJson<unknown>(GBFS_AUTODISCOVERY));
      return { info: await fetchJson<unknown>(stationInformation), statusUrl: stationStatus };
    },
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
