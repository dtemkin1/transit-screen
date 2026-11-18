import type { Discovered } from '../discovery';
import type {
  Alert, BoardGroup, BoardPanel, BoardRow, Departure, Mode, PanelId, PanelStatus, RouteInfo, Source, Stop, TimeCell,
} from '../types';
import type { PassioStatic } from '../gtfs/passio-static';
import { countdownLabel } from './countdown';
import { sourceStatus, worstStatus, type Health } from './health';

export interface BoardInput {
  discovered: Discovered; nowMs: number;
  live: Record<Source, Departure[]>; scheduled: Record<Source, Departure[]>;
  health: Record<Source, Health>; alerts: Alert[];
  hide: string[];            // route ids, bare or `${source}:${routeId}`
  extraRoutes: RouteInfo[];  // routes learned from realtime/schedule responses
}

const SOURCES: readonly Source[] = ['mbta', 'mit', 'ezride', 'bluebikes'];
const PANEL_SOURCES: Record<Exclude<PanelId, 'bikes'>, Source[]> = {
  subway: ['mbta'], bus: ['mbta', 'ezride'], shuttle: ['mit'],
};
const PANEL_MODES: Record<Exclude<PanelId, 'bikes'>, Mode[]> = {
  subway: ['subway'], bus: ['bus', 'ezride'], shuttle: ['shuttle'],
};
const PASSIO_SOURCES: readonly Source[] = ['mit', 'ezride'];
const MAX_TIMES = 3;

/** A departure joined to its stop and route, with its countdown label. */
interface Placed { d: Departure; stop: Stop; route: RouteInfo; label: string }

const stopKey = (s: Stop) => `${s.source}:${s.id}`;
const byWalk = (a: Stop, b: Stop) => a.walkSec - b.walkSec || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = out.get(k);
    if (list) list.push(it); else out.set(k, [it]);
  }
  return out;
}

/**
 * Within a minute, these are one vehicle shown twice and are merged: the same trip reported
 * twice, the same vehicle on two back-to-back trips (Passio loops), and MBTA "ADDED" trips
 * predicted beside a scheduled one. Two different vehicles close together both show.
 */
const DUPLICATE_WINDOW_MS = 60_000;
const same = (x?: string, y?: string) => x !== undefined && x === y;
const isDuplicate = (a: Placed, b: Placed) =>
  b.d.departureTime - a.d.departureTime < DUPLICATE_WINDOW_MS &&
  (same(a.d.tripId, b.d.tripId) || same(a.d.vehicleId, b.d.vehicleId) ||
    [a.d.tripId, b.d.tripId].some((id) => id?.startsWith('ADDED-')));

/**
 * ≤ 3 cells in time order, with the departure behind the first one (it labels the row).
 * Departures you can't walk to in time are left out, and duplicates are merged.
 */
function timeCells(placed: Placed[], nowMs: number): { cells: TimeCell[]; lead?: Placed } {
  const shown: Placed[] = [];
  for (const p of [...placed].sort((a, b) => a.d.departureTime - b.d.departureTime)) {
    // Compare against the walk shown on screen (rounded up), so the two never contradict.
    if (p.d.departureTime - nowMs < Math.ceil(p.stop.walkSec / 60) * 60_000) continue;
    if (shown.some((s) => isDuplicate(s, p))) continue;
    shown.push(p);
    if (shown.length === MAX_TIMES) break;
  }
  const cells = shown.map((p): TimeCell => {
    const status = p.d.status?.trim();
    return { label: p.label, live: p.d.live, departureTime: p.d.departureTime, ...(status ? { status } : {}) };
  });
  return { cells, lead: shown[0] };
}

const passioServingCache = new WeakMap<PassioStatic, Map<string, Set<string>>>();

/** Stop ids each Passio direction (`${routeId}:${headsign}`) boards at; a trip's last stop is drop-off only. */
function passioServing(p: PassioStatic): Map<string, Set<string>> {
  const cached = passioServingCache.get(p);
  if (cached) return cached;
  const out = new Map<string, Set<string>>();
  for (const [tripId, trip] of p.trips) {
    const key = `${trip.routeId}:${trip.headsign}`;
    const set = out.get(key) ?? new Set<string>();
    for (const t of (p.stopTimes.get(tripId) ?? []).slice(0, -1)) set.add(t.stopId);
    out.set(key, set);
  }
  passioServingCache.set(p, out);
  return out;
}

const nextDeparture = (row: BoardRow): number => row.times[0]?.departureTime ?? Infinity;

export function buildBoard(input: BoardInput): { panels: BoardPanel[]; alerts: Alert[] } {
  const { discovered, nowMs, hide } = input;

  const status = {} as Record<Source, PanelStatus>;
  for (const s of SOURCES) status[s] = sourceStatus(input.health[s], nowMs, input.scheduled[s].some((d) => d.departureTime >= nowMs));

  const routes = new Map(discovered.routes);
  for (const r of input.extraRoutes) {
    const k = `${r.source}:${r.id}`;
    if (!routes.has(k)) routes.set(k, r);
  }
  const stopByPlatform = new Map<string, Stop>();
  for (const s of discovered.stops) for (const p of s.platformIds) stopByPlatform.set(`${s.source}:${p}`, s);

  const place = (d: Departure): Placed | null => {
    if (hide.includes(d.routeId) || hide.includes(`${d.source}:${d.routeId}`)) return null;
    const stop = stopByPlatform.get(`${d.source}:${d.stopId}`);
    const route = routes.get(`${d.source}:${d.routeId}`);
    const label = countdownLabel(d, nowMs);
    return stop && route && label !== null ? { d, stop, route, label } : null;
  };
  const placeAll = (ds: Departure[]) => ds.map(place).filter((p): p is Placed => p !== null);
  const mergeKey = (p: Placed) => `${stopKey(p.stop)}|${p.d.directionKey}`;

  // Live/scheduled merge per (stop, direction).
  const shown: Placed[] = [];
  for (const s of SOURCES) {
    const liveUsable = status[s] === 'ok' || status[s] === 'delayed';
    const liveRaw = liveUsable ? input.live[s] : [];
    const live = groupBy(placeAll(liveRaw), mergeKey);
    // A scheduled departure whose trip live data has at the same stop (in or out of
    // the window, however late or early) is a stale copy of that trip.
    const tripAtStop = (d: Departure) => {
      const stop = stopByPlatform.get(`${d.source}:${d.stopId}`);
      return d.tripId !== undefined && stop ? `${d.tripId}|${stopKey(stop)}` : null;
    };
    const liveTrips = new Set(liveRaw.map(tripAtStop));
    const scheduled = placeAll(input.scheduled[s]).filter((p) => {
      const k = tripAtStop(p.d);
      return k === null || !liveTrips.has(k);
    });
    const sched = groupBy(scheduled, mergeKey);
    for (const k of new Set([...live.keys(), ...sched.keys()])) shown.push(...(live.get(k) ?? sched.get(k)!));
  }

  const panels: BoardPanel[] = [];
  const shownStops = new Set<Stop>();
  const shownRoutes = new Set<string>();
  const panelStatus = (id: Exclude<PanelId, 'bikes'>) => worstStatus(PANEL_SOURCES[id].map((s) => status[s]));
  const emit = (id: Exclude<PanelId, 'bikes'>, title: string, groups: BoardGroup[]) => {
    const st = panelStatus(id);
    // A failing source keeps its panel (empty) so the UI can say live data is unavailable.
    const failing = st !== 'ok' && st !== 'delayed' && discovered.stops.some((s) => PANEL_MODES[id].includes(s.mode));
    if (groups.length > 0 || failing) panels.push({ id, title, status: st, groups });
  };
  const makeRow = (key: string, placed: Placed[], extra: Partial<BoardRow> = {}): BoardRow | null => {
    const { cells: times, lead } = timeCells(placed, nowMs);
    if (!lead) return null;
    for (const p of placed) { shownStops.add(p.stop); shownRoutes.add(`${p.d.source}:${p.d.routeId}`); }
    return { key, route: lead.route, headsign: lead.d.headsign, times, ...extra };
  };

  // Subway: one group per station, rows per route + headsign.
  const subway = shown.filter((p) => p.d.mode === 'subway');
  const stations = [...new Set(subway.map((p) => p.stop))].sort(byWalk);
  const subwayGroups: BoardGroup[] = [];
  for (const station of stations) {
    const atStation = groupBy(subway.filter((p) => p.stop === station), (p) => `${p.d.routeId}:${p.d.headsign}`);
    const rows = [...atStation.keys()].sort()
      .map((k) => makeRow(k, atStation.get(k)!))
      .filter((r): r is BoardRow => r !== null);
    if (rows.length > 0) subwayGroups.push({
      header: { name: station.name, walkMin: Math.ceil(station.walkSec / 60), walkEstimated: station.walkEstimated },
      rows,
    });
  }
  const subwayRoutes = new Set(subwayGroups.flatMap((g) => g.rows.map((r) => r.route)));
  const subwayTitle = subwayRoutes.size === 1 ? [...subwayRoutes][0].longName : 'Subway';
  emit('subway', subwayTitle, subwayGroups);

  // Bus and shuttle: one row per (source, direction), at the closest stop serving it.
  // "Serving" ignores the time window and the merge, so the chosen stop does not flip
  // as departures come and go; if that stop has nothing in the window, the row is dropped.
  const serving = new Map<string, Set<Stop>>();
  const serve = (key: string, stop: Stop | undefined) => {
    if (!stop) return;
    const set = serving.get(key);
    if (set) set.add(stop); else serving.set(key, new Set([stop]));
  };
  for (const s of SOURCES) {
    for (const d of [...input.live[s], ...input.scheduled[s]]) {
      serve(`${d.source}:${d.directionKey}`, stopByPlatform.get(`${d.source}:${d.stopId}`));
    }
  }
  for (const p of [discovered.passio.mit, discovered.passio.ezride]) {
    if (!p) continue;
    for (const [dirKey, stopIds] of passioServing(p)) {
      for (const id of stopIds) serve(`${p.source}:${dirKey}`, stopByPlatform.get(`${p.source}:${id}`));
    }
  }
  const closestRows = (placed: Placed[]): BoardGroup[] => {
    const rows: BoardRow[] = [];
    for (const [key, list] of groupBy(placed, (p) => `${p.d.source}:${p.d.directionKey}`)) {
      const stop = [...serving.get(key)!].sort(byWalk)[0];
      const row = makeRow(key, list.filter((p) => p.stop === stop),
        { stopName: stop.name, walkMin: Math.ceil(stop.walkSec / 60), walkEstimated: stop.walkEstimated });
      if (row) rows.push(row);
    }
    rows.sort((a, b) => nextDeparture(a) - nextDeparture(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return rows.length > 0 ? [{ rows }] : [];
  };
  emit('bus', 'Buses', closestRows(shown.filter((p) => p.d.mode === 'bus' || p.d.mode === 'ezride')));
  emit('shuttle', 'MIT shuttles', closestRows(shown.filter((p) => p.d.mode === 'shuttle')));

  if (discovered.bikes.length > 0) {
    panels.push({ id: 'bikes', title: 'Bluebikes', status: sourceStatus(input.health.bluebikes, nowMs, false), groups: [] });
  }

  return { panels, alerts: relevantAlerts(input.alerts, shownStops, shownRoutes) };
}

function relevantAlerts(alerts: Alert[], stops: Set<Stop>, routes: Set<string>): Alert[] {
  const stopIds = new Set<string>();
  const sources = new Set<Source>();
  for (const s of stops) {
    sources.add(s.source);
    stopIds.add(`${s.source}:${s.id}`);
    for (const p of s.platformIds) stopIds.add(`${s.source}:${p}`);
  }
  const seen = new Set<string>();
  return alerts.filter((a) => {
    const relevant =
      a.routeIds.some((r) => routes.has(`${a.source}:${r}`)) ||
      a.stopIds.some((s) => stopIds.has(`${a.source}:${s}`)) ||
      (PASSIO_SOURCES.includes(a.source) && a.routeIds.length === 0 && sources.has(a.source));
    const key = `${a.source}:${a.id}`;
    if (!relevant || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
