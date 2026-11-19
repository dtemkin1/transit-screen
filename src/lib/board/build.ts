import type { Discovered } from '../data/discovery';
import type {
  Alert, BoardGroup, BoardPanel, BoardRow, Departure, PanelStatus, RouteInfo, Source, Station, Stop, TimeCell,
} from '../types';
import { countdownLabel } from './countdown';
import { sourceStatus, worstStatus, type Health } from './health';
import { PANELS, type PanelDef } from './panels';

export interface BoardInput {
  discovered: Discovered; nowMs: number;
  feeds: readonly { id: Source; name: string }[];
  live: Record<Source, Departure[]>; scheduled: Record<Source, Departure[]>;
  health: Record<Source, Health>; alerts: Alert[];
  /** Discovered stations with their latest counts. */
  stations: Station[];
  /** Route or alert ids, bare or `${source}:${id}`. */
  hide: string[];
  /** Routes learned from realtime and schedule responses. */
  extraRoutes: RouteInfo[];
}

const MAX_TIMES = 3;

/** A departure joined to its stop and route, with its countdown label. */
interface Placed { d: Departure; stop: Stop; route: RouteInfo; label: string }

const stopKey = (s: Stop) => `${s.source}:${s.id}`;
const byWalk = (a: Stop, b: Stop) => a.walkSec - b.walkSec || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const walkMin = (s: { walkSec: number }) => Math.ceil(s.walkSec / 60);

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = out.get(k);
    if (list) list.push(it); else out.set(k, [it]);
  }
  return out;
}

const DUPLICATE_WINDOW_MS = 60_000;
const same = (x?: string, y?: string) => x !== undefined && x === y;
/**
 * One vehicle shown twice within a minute (same trip, same vehicle, or an MBTA "ADDED" copy) is
 * merged; two different vehicles close together both show.
 */
const isDuplicate = (a: Placed, b: Placed) =>
  b.d.departureTime - a.d.departureTime < DUPLICATE_WINDOW_MS &&
  (same(a.d.tripId, b.d.tripId) || same(a.d.vehicleId, b.d.vehicleId) ||
    [a.d.tripId, b.d.tripId].some((id) => id?.startsWith('ADDED-')));

/** Up to 3 reachable, de-duplicated times, plus the departure behind the first (it labels the row). */
function timeCells(placed: Placed[], nowMs: number): { cells: TimeCell[]; lead?: Placed } {
  const shown: Placed[] = [];
  for (const p of [...placed].sort((a, b) => a.d.departureTime - b.d.departureTime)) {
    // Compare against the walk shown on screen (rounded up), so the two never contradict.
    if (p.d.departureTime - nowMs < walkMin(p.stop) * 60_000) continue;
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

const nextDeparture = (row: BoardRow): number => row.times[0]?.departureTime ?? Infinity;

const NOTE: Partial<Record<PanelStatus, string>> = {
  'delayed': 'data delayed',
  'schedule-fallback': 'live data unavailable, showing schedule',
  'unavailable': 'live data unavailable',
};

/** One note per agency that isn't fully live; shared panels name the agency so live rows aren't doubted. */
function panelNotes(sources: Source[], status: Record<Source, PanelStatus>, names: Map<Source, string>): string[] {
  return sources.flatMap((s) => {
    const note = NOTE[status[s]];
    if (!note) return [];
    return [sources.length > 1 ? `${names.get(s)}: ${note}` : note[0].toUpperCase() + note.slice(1)];
  });
}

export function buildBoard(input: BoardInput): { panels: BoardPanel[]; alerts: Alert[] } {
  const { discovered, nowMs, hide } = input;
  const sources = input.feeds.map((f) => f.id);
  const names = new Map(input.feeds.map((f) => [f.id, f.name]));

  const status = {} as Record<Source, PanelStatus>;
  for (const s of sources) {
    status[s] = sourceStatus(input.health[s], nowMs, input.scheduled[s].some((d) => d.departureTime >= nowMs));
  }

  const routes = new Map(discovered.routes);
  for (const r of input.extraRoutes) {
    const k = `${r.source}:${r.id}`;
    if (!routes.has(k)) routes.set(k, r);
  }
  const stopByPlatform = new Map<string, Stop>();
  for (const s of discovered.stops) for (const p of s.platformIds) stopByPlatform.set(`${s.source}:${p}`, s);
  const stopOf = (d: Departure) => stopByPlatform.get(`${d.source}:${d.stopId}`);

  const place = (d: Departure): Placed | null => {
    if (hide.includes(d.routeId) || hide.includes(`${d.source}:${d.routeId}`)) return null;
    const stop = stopOf(d);
    const route = routes.get(`${d.source}:${d.routeId}`);
    const label = countdownLabel(d, nowMs);
    return stop && route && label !== null ? { d, stop, route, label } : null;
  };
  const placeAll = (ds: Departure[]) => ds.map(place).filter((p): p is Placed => p !== null);
  const mergeKey = (p: Placed) => `${stopKey(p.stop)}|${p.d.directionKey}`;

  // Per stop and direction, live departures replace scheduled ones.
  const shown: Placed[] = [];
  for (const s of sources) {
    const liveUsable = status[s] === 'ok' || status[s] === 'delayed';
    const liveRaw = liveUsable ? input.live[s] : [];
    const live = groupBy(placeAll(liveRaw), mergeKey);
    /**
     * Trip and stop, to drop a scheduled departure whose trip live data has at the same stop
     * (in or out of the window, however late or early): it's a stale copy of that trip.
     */
    const tripAtStop = (d: Departure) => {
      const stop = stopOf(d);
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

  const shownStops = new Set<Stop>();
  const shownRoutes = new Set<string>();
  const makeRow = (key: string, placed: Placed[], extra: Partial<BoardRow> = {}): BoardRow | null => {
    const { cells: times, lead } = timeCells(placed, nowMs);
    if (!lead) return null;
    for (const p of placed) { shownStops.add(p.stop); shownRoutes.add(`${p.d.source}:${p.d.routeId}`); }
    return { key, route: lead.route, headsign: lead.d.headsign, times, ...extra };
  };

  /** One group per station, with a row per route and headsign. */
  const byStation = (placed: Placed[]): BoardGroup[] => {
    const groups: BoardGroup[] = [];
    for (const station of [...new Set(placed.map((p) => p.stop))].sort(byWalk)) {
      const atStation = groupBy(placed.filter((p) => p.stop === station), (p) => `${p.d.routeId}:${p.d.headsign}`);
      const rows = [...atStation.keys()].sort()
        .map((k) => makeRow(k, atStation.get(k)!))
        .filter((r): r is BoardRow => r !== null);
      if (rows.length > 0) groups.push({
        header: { name: station.name, walkMin: walkMin(station), walkEstimated: station.walkEstimated },
        rows,
      });
    }
    return groups;
  };

  // One row per direction at the closest stop serving it, chosen outside the time window so it
  // never flips; if that stop has nothing in the window, the row is dropped.
  const serving = new Map<string, Set<Stop>>();
  const serve = (key: string, stop: Stop | undefined) => {
    if (!stop) return;
    const set = serving.get(key);
    if (set) set.add(stop); else serving.set(key, new Set([stop]));
  };
  for (const s of sources) {
    for (const d of [...input.live[s], ...input.scheduled[s]]) serve(`${d.source}:${d.directionKey}`, stopOf(d));
  }
  for (const [key, platforms] of discovered.serving) for (const p of platforms) serve(key, stopByPlatform.get(p));
  const closestStop = (placed: Placed[]): BoardGroup[] => {
    const rows: BoardRow[] = [];
    for (const [key, list] of groupBy(placed, (p) => `${p.d.source}:${p.d.directionKey}`)) {
      const stop = [...serving.get(key)!].sort(byWalk)[0];
      const row = makeRow(key, list.filter((p) => p.stop === stop),
        { stopName: stop.name, walkMin: walkMin(stop), walkEstimated: stop.walkEstimated });
      if (row) rows.push(row);
    }
    rows.sort((a, b) => nextDeparture(a) - nextDeparture(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return rows.length > 0 ? [{ rows }] : [];
  };

  const title = (def: PanelDef, groups: BoardGroup[], panelSources: Source[]) => {
    const named = def.nameBy === 'route'
      ? new Set(groups.flatMap((g) => g.rows.map((r) => r.route.longName)))
      : def.nameBy === 'feed' ? new Set(panelSources.map((s) => names.get(s)!)) : new Set<string>();
    return named.size === 1 ? [...named][0] : def.title;
  };

  const panels: BoardPanel[] = [];
  for (const def of PANELS) {
    // A panel answers only for feeds with stops in it: a stale EZRide feed says nothing about
    // the Buses panel when no EZRide stop is nearby.
    const stations = input.stations.filter((s) => s.mode === def.id);
    const panelSources = sources.filter((src) =>
      discovered.stops.some((s) => s.source === src && s.mode === def.id) || stations.some((s) => s.source === src));
    const st = worstStatus(panelSources.map((s) => status[s]));
    const panel = (groups: BoardGroup[]): BoardPanel =>
      ({ id: def.id, title: title(def, groups, panelSources), status: st, groups, notes: panelNotes(panelSources, status, names) });

    if (def.rows === 'stations') {
      if (stations.length > 0) panels.push({ ...panel([]), stations });
      continue;
    }
    const placed = shown.filter((p) => p.d.mode === def.id);
    const groups = def.rows === 'by-station' ? byStation(placed) : closestStop(placed);
    // A failing feed keeps its panel (empty) so the UI can say live data is unavailable.
    const failing = st !== 'ok' && st !== 'delayed' && panelSources.length > 0;
    if (groups.length > 0 || failing) panels.push(panel(groups));
  }

  return { panels, alerts: relevantAlerts(input.alerts, shownStops, shownRoutes, hide) };
}

function relevantAlerts(alerts: Alert[], stops: Set<Stop>, routes: Set<string>, hide: string[]): Alert[] {
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
      (a.agencyWide === true && sources.has(a.source));
    const key = `${a.source}:${a.id}`;
    if (!relevant || seen.has(key) || hide.includes(a.id) || hide.includes(key)) return false;
    seen.add(key);
    return true;
  });
}
