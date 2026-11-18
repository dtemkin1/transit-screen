import type { Discovered } from '../discovery';
import type {
  Alert, BoardGroup, BoardPanel, BoardRow, Departure, PanelId, PanelStatus, RouteInfo, Source, Stop, TimeCell,
} from '../types';
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
const PASSIO_SOURCES: readonly Source[] = ['mit', 'ezride'];
const MAX_TIMES = 3;
const SAME_TRIP_MS = 2 * 60_000;

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

/** ≤ 3 cells in time order; an unreachable time may only lead, and only one. */
function timeCells(placed: Placed[], nowMs: number): TimeCell[] {
  const cells = [...placed]
    .sort((a, b) => a.d.departureTime - b.d.departureTime)
    .map((p): TimeCell => ({
      label: p.label, live: p.d.live, departureTime: p.d.departureTime,
      reachable: p.d.departureTime - nowMs >= p.stop.walkSec * 1000,
    }));
  const firstReachable = cells.findIndex((c) => c.reachable);
  if (firstReachable <= 0) return cells.slice(0, firstReachable === -1 ? 1 : MAX_TIMES);
  return [cells[0], ...cells.slice(firstReachable, firstReachable + MAX_TIMES - 1)];
}

function firstReachable(row: BoardRow): number {
  return row.times.find((t) => t.reachable)?.departureTime ?? Infinity;
}

export function buildBoard(input: BoardInput): { panels: BoardPanel[]; alerts: Alert[] } {
  const { discovered, nowMs, hide } = input;

  const status = {} as Record<Source, PanelStatus>;
  for (const s of SOURCES) status[s] = sourceStatus(input.health[s], nowMs, input.scheduled[s].length > 0);

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
    // Live departures by trip and stop, including ones already outside the window,
    // so a scheduled copy of a trip that live data says has left does not reappear.
    const tripAtStop = (d: Departure) => {
      const stop = stopByPlatform.get(`${d.source}:${d.stopId}`);
      return d.tripId !== undefined && stop ? `${d.tripId}|${stopKey(stop)}` : null;
    };
    const liveByTrip = groupBy(liveRaw.filter((d) => tripAtStop(d) !== null), (d) => tripAtStop(d)!);
    const scheduled = placeAll(input.scheduled[s]).filter((p) =>
      !(liveByTrip.get(tripAtStop(p.d) ?? '') ?? []).some((l) => Math.abs(l.departureTime - p.d.departureTime) <= SAME_TRIP_MS));
    const sched = groupBy(scheduled, mergeKey);
    for (const k of new Set([...live.keys(), ...sched.keys()])) shown.push(...(live.get(k) ?? sched.get(k)!));
  }

  const panels: BoardPanel[] = [];
  const shownStops = new Set<Stop>();
  const shownRoutes = new Set<string>();
  const panelStatus = (id: Exclude<PanelId, 'bikes'>) => worstStatus(PANEL_SOURCES[id].map((s) => status[s]));
  const emit = (id: Exclude<PanelId, 'bikes'>, title: string, groups: BoardGroup[]) => {
    if (groups.length > 0) panels.push({ id, title, status: panelStatus(id), groups });
  };
  const makeRow = (key: string, placed: Placed[], extra: Partial<BoardRow> = {}): BoardRow | null => {
    const times = timeCells(placed, nowMs);
    if (times.length === 0) return null;
    const first = [...placed].sort((a, b) => a.d.departureTime - b.d.departureTime)[0];
    for (const p of placed) { shownStops.add(p.stop); shownRoutes.add(`${p.d.source}:${p.d.routeId}`); }
    return { key, route: first.route, headsign: first.d.headsign, times, ...extra };
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
    if (rows.length > 0) subwayGroups.push({ header: { name: station.name, walkMin: Math.ceil(station.walkSec / 60) }, rows });
  }
  const subwayRoutes = new Set(subwayGroups.flatMap((g) => g.rows.map((r) => r.route)));
  const subwayTitle = subwayRoutes.size === 1 ? [...subwayRoutes][0].longName : 'Subway';
  emit('subway', subwayTitle, subwayGroups);

  // Bus and shuttle: one row per (source, direction), at the closest stop serving it.
  const closestRows = (placed: Placed[]): BoardGroup[] => {
    const rows: BoardRow[] = [];
    for (const [key, list] of groupBy(placed, (p) => `${p.d.source}:${p.d.directionKey}`)) {
      const stop = [...new Set(list.map((p) => p.stop))].sort(byWalk)[0];
      const row = makeRow(key, list.filter((p) => p.stop === stop),
        { stopName: stop.name, walkMin: Math.ceil(stop.walkSec / 60) });
      if (row) rows.push(row);
    }
    rows.sort((a, b) => firstReachable(a) - firstReachable(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return rows.length > 0 ? [{ rows }] : [];
  };
  emit('bus', 'Buses', closestRows(shown.filter((p) => p.d.mode === 'bus' || p.d.mode === 'ezride')));
  emit('shuttle', 'MIT Shuttles', closestRows(shown.filter((p) => p.d.mode === 'shuttle')));

  if (discovered.bikes.length > 0) {
    panels.push({ id: 'bikes', title: 'BlueBikes', status: sourceStatus(input.health.bluebikes, nowMs, false), groups: [] });
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
