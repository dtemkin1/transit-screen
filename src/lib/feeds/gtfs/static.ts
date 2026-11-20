import { strFromU8, unzipSync } from 'fflate';
import type { Departure, Mode, RouteInfo, Source } from '../../types';
import { gtfsTimeToEpoch, serviceDate, weekdayOf } from '../../util/time';
import { parseCsv } from './csv';

interface CalendarRow {
  days: Record<string, boolean>;
  start: string;
  end: string;
}

export interface GtfsStatic {
  source: Source;
  mode: Mode;
  stops: Map<string, { id: string; name: string; lat: number; lon: number }>;
  routes: Map<string, RouteInfo>;
  trips: Map<string, { routeId: string; serviceId: string; headsign: string }>;
  stopTimes: Map<string, { stopId: string; seq: number; dep: string }[]>;
  calendar: Map<string, CalendarRow>;
  calendarDates: { serviceId: string; date: string; add: boolean }[];
  /** See `GtfsOptions.mergeRoutes`. */
  mergeRoutes: boolean;
}

/** A trip's direction: its route and headsign, or the headsign alone when routes are merged. */
export const directionKey = (s: GtfsStatic, routeId: string, headsign: string) =>
  s.mergeRoutes ? headsign : `${routeId}:${headsign}`;

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const OUT_OF_SERVICE = /\bout of service\b|^OOS$/i;

export interface GtfsOptions {
  source: Source;
  mode: Mode;
  /** For routes without route_color. */
  color: string;
  /** 'last-stop' ignores trip_headsign. */
  headsign?: 'trip' | 'last-stop';
  /** One row per destination across routes, for routes riders can't tell apart (one shared badge). */
  mergeRoutes?: boolean;
}

function toSec(hms: string): number {
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function toHms(sec: number): string {
  const t = Math.round(sec);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}

function hexColor(raw: string | undefined, fallback: string): string {
  const v = (raw ?? '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(v) ? `#${v.toUpperCase()}` : fallback;
}

interface RawStopTime { stopId: string; seq: number; sec: number | null; dist: number | null }

/** Fill blank times between timepoints; rows outside the first/last timepoint are dropped. */
function resolveTimes(rows: RawStopTime[]): { stopId: string; seq: number; dep: string }[] {
  const known = rows.flatMap((r, i) => (r.sec === null ? [] : [i]));
  const out: { stopId: string; seq: number; dep: string }[] = [];
  for (let k = 0; k < known.length; k++) {
    const a = rows[known[k]];
    out.push({ stopId: a.stopId, seq: a.seq, dep: toHms(a.sec!) });
    const nextIdx = known[k + 1];
    if (nextIdx === undefined) break;
    const b = rows[nextIdx];
    const between = rows.slice(known[k] + 1, nextIdx);
    const useDist =
      a.dist !== null && b.dist !== null && b.dist > a.dist && between.every((r) => r.dist !== null);
    for (const r of between) {
      const frac = useDist
        ? (r.dist! - a.dist!) / (b.dist! - a.dist!)
        : b.seq === a.seq ? 0 : (r.seq - a.seq) / (b.seq - a.seq);
      out.push({ stopId: r.stopId, seq: r.seq, dep: toHms(a.sec! + frac * (b.sec! - a.sec!)) });
    }
  }
  return out;
}

export function parseGtfsZip(
  bytes: Uint8Array, { source, mode, color, headsign: headsignFrom = 'trip', mergeRoutes = false }: GtfsOptions,
): GtfsStatic {
  const entries = unzipSync(bytes, { filter: (f) => f.name !== 'shapes.txt' });
  const table = (name: string) => (entries[name] ? parseCsv(strFromU8(entries[name])) : []);

  const stops: GtfsStatic['stops'] = new Map();
  for (const r of table('stops.txt')) {
    stops.set(r.stop_id, { id: r.stop_id, name: r.stop_name.trim(), lat: Number(r.stop_lat), lon: Number(r.stop_lon) });
  }

  const routes: GtfsStatic['routes'] = new Map();
  for (const r of table('routes.txt')) {
    const longName = r.route_long_name?.trim() ?? '';
    // Passio publishes an "OOS (out of service)" route; it isn't service a rider can take.
    if (OUT_OF_SERVICE.test(longName) || OUT_OF_SERVICE.test(r.route_short_name?.trim() ?? '')) continue;
    routes.set(r.route_id, {
      id: r.route_id, source, mode,
      shortName: r.route_short_name?.trim() || longName,
      longName,
      color: hexColor(r.route_color, color),
      textColor: hexColor(r.route_text_color, '#FFFFFF'),
    });
  }

  const rawByTrip = new Map<string, RawStopTime[]>();
  for (const r of table('stop_times.txt')) {
    const t = (r.departure_time || r.arrival_time || '').trim();
    const dist = r.shape_dist_traveled?.trim() ? Number(r.shape_dist_traveled) : null;
    const list = rawByTrip.get(r.trip_id) ?? [];
    list.push({
      stopId: r.stop_id, seq: Number(r.stop_sequence),
      sec: t ? toSec(t) : null,
      dist: dist !== null && Number.isFinite(dist) ? dist : null,
    });
    rawByTrip.set(r.trip_id, list);
  }
  const stopTimes: GtfsStatic['stopTimes'] = new Map();
  for (const [tripId, rows] of rawByTrip) {
    stopTimes.set(tripId, resolveTimes(rows.sort((x, y) => x.seq - y.seq)));
  }

  const trips: GtfsStatic['trips'] = new Map();
  for (const r of table('trips.txt')) {
    if (!routes.has(r.route_id)) continue;
    const last = stopTimes.get(r.trip_id)?.at(-1);
    const own = headsignFrom === 'trip' ? r.trip_headsign?.trim() : '';
    const headsign =
      own ||
      (last && stops.get(last.stopId)?.name) ||
      routes.get(r.route_id)?.longName ||
      '';
    trips.set(r.trip_id, { routeId: r.route_id, serviceId: r.service_id, headsign });
  }

  const calendar: GtfsStatic['calendar'] = new Map();
  for (const r of table('calendar.txt')) {
    calendar.set(r.service_id, {
      days: Object.fromEntries(DAYS.map((d) => [d, r[d]?.trim() === '1'])),
      start: r.start_date, end: r.end_date,
    });
  }
  const calendarDates = table('calendar_dates.txt').map((r) => ({
    serviceId: r.service_id, date: r.date, add: r.exception_type?.trim() === '1',
  }));

  return { source, mode, stops, routes, trips, stopTimes, calendar, calendarDates, mergeRoutes };
}

export function activeServiceIds(s: GtfsStatic, sd: string): Set<string> {
  const day = weekdayOf(sd);
  const ids = new Set<string>();
  for (const [id, c] of s.calendar) {
    if (c.days[day] && c.start <= sd && sd <= c.end) ids.add(id);
  }
  for (const e of s.calendarDates) {
    if (e.date !== sd) continue;
    if (e.add) ids.add(e.serviceId);
    else ids.delete(e.serviceId);
  }
  return ids;
}

/**
 * Each direction key and route of trips running on `sd` that board at one of `stopIds` (a trip's last
 * stop is drop-off only), sorted by key.
 */
export function todaysService(s: GtfsStatic, stopIds: ReadonlySet<string>, sd: string): { key: string; routeId: string }[] {
  const active = activeServiceIds(s, sd);
  const found = new Map<string, { key: string; routeId: string }>();
  for (const [tripId, trip] of s.trips) {
    if (!active.has(trip.serviceId)) continue;
    const boards = (s.stopTimes.get(tripId) ?? []).slice(0, -1).some((t) => stopIds.has(t.stopId));
    const key = directionKey(s, trip.routeId, trip.headsign);
    if (boards) found.set(`${key}|${trip.routeId}`, { key, routeId: trip.routeId });
  }
  return [...found.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function shiftDate(sd: string, days: number): string {
  const d = new Date(Date.UTC(+sd.slice(0, 4), +sd.slice(4, 6) - 1, +sd.slice(6, 8)) + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

export function scheduledDepartures(
  s: GtfsStatic, stopIds: Set<string>, nowMs: number, windowMs: number,
): Departure[] {
  const today = serviceDate(nowMs);
  const out: Departure[] = [];
  // serviceDate() lags the calendar date before 03:00, so also look one day ahead.
  for (const sd of [shiftDate(today, -1), today, shiftDate(today, 1)]) {
    const active = activeServiceIds(s, sd);
    if (active.size === 0) continue;
    for (const [tripId, trip] of s.trips) {
      if (!active.has(trip.serviceId)) continue;
      const times = s.stopTimes.get(tripId);
      if (!times) continue;
      for (let i = 0; i < times.length - 1; i++) {
        const st = times[i];
        if (!stopIds.has(st.stopId)) continue;
        const t = gtfsTimeToEpoch(sd, st.dep);
        if (t < nowMs || t > nowMs + windowMs) continue;
        out.push({
          source: s.source, mode: s.mode, routeId: trip.routeId, stopId: st.stopId,
          directionKey: directionKey(s, trip.routeId, trip.headsign), headsign: trip.headsign,
          departureTime: t, live: false, tripId,
        });
      }
    }
  }
  return out.sort((a, b) => a.departureTime - b.departureTime);
}
