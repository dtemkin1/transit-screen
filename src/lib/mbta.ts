import type { Config } from '../config';
import { candidateRadiusM, metresToDegrees } from './geo';
import { gtfsTimeToEpoch, serviceDate } from './time';
import type { Alert, Departure, Mode, RouteInfo, Stop } from './types';
import { fetchJson, workerUrl } from './worker-client';

export interface MbtaCandidates { subway: Stop[]; bus: Stop[]; routes: Map<string, RouteInfo> }

export const SHOWN_EFFECTS: readonly string[] = [
  'DELAY', 'SUSPENSION', 'SHUTTLE', 'DETOUR', 'STOP_CLOSURE', 'STATION_CLOSURE',
  'SERVICE_CHANGE', 'CANCELLATION', 'SNOW_ROUTE',
];
export const SILVER_LINE_IDS: readonly string[] = ['741', '742', '743', '746', '749', '751'];
const MAX_IDS_PER_REQUEST = 100;

interface Resource {
  id: string; type: string;
  attributes?: Record<string, any>;
  relationships?: Record<string, { data?: { id: string; type: string } | null }>;
}
interface Doc { data?: Resource[]; included?: Resource[] }

const asDoc = (json: unknown): Doc => (json && typeof json === 'object' ? (json as Doc) : {});
const rel = (r: Resource, name: string): string | undefined => r.relationships?.[name]?.data?.id;

function url(cfg: Config, path: string, query: Record<string, string>): string {
  const qs = Object.entries(query).map(([k, v]) => `${k}=${v}`).join('&');
  return workerUrl(cfg, `mbta/${path}?${qs}`);
}

export function chunk<T>(items: readonly T[], size = MAX_IDS_PER_REQUEST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---- stops ----

export function stopsUrl(cfg: Config, mode: 'subway' | 'bus'): string {
  const radius = metresToDegrees(candidateRadiusM(cfg.modes[mode].maxWalkMin, cfg)).toFixed(5);
  return url(cfg, 'stops', {
    'filter[latitude]': String(cfg.location.lat),
    'filter[longitude]': String(cfg.location.lon),
    'filter[radius]': radius,
    'filter[route_type]': mode === 'subway' ? '0,1' : '3',
    include: 'parent_station',
    'fields[stop]': 'name,latitude,longitude',
  });
}

export function parseStops(json: unknown, mode: 'subway' | 'bus'): Stop[] {
  const doc = asDoc(json);
  const parents = new Map((doc.included ?? []).map((r) => [r.id, r]));
  const out = new Map<string, Stop>();
  for (const s of doc.data ?? []) {
    const parent = mode === 'subway' ? parents.get(rel(s, 'parent_station') ?? '') : undefined;
    const anchor = parent ?? s;
    const existing = out.get(anchor.id);
    if (existing) {
      if (!existing.platformIds.includes(s.id)) existing.platformIds.push(s.id);
      continue;
    }
    out.set(anchor.id, {
      id: anchor.id, source: 'mbta', mode,
      name: anchor.attributes?.name ?? '',
      lat: anchor.attributes?.latitude, lon: anchor.attributes?.longitude,
      platformIds: [s.id], walkSec: 0, walkEstimated: false,
    });
  }
  return [...out.values()];
}

export async function fetchMbtaCandidates(cfg: Config): Promise<MbtaCandidates> {
  const [subway, bus] = await Promise.all([
    fetchJson<unknown>(stopsUrl(cfg, 'subway')),
    fetchJson<unknown>(stopsUrl(cfg, 'bus')),
  ]);
  return { subway: parseStops(subway, 'subway'), bus: parseStops(bus, 'bus'), routes: new Map() };
}

// ---- routes / departures ----

function routeModeOf(type: unknown): Mode | undefined {
  if (type === 0 || type === 1) return 'subway';
  if (type === 3) return 'bus';
  return undefined;
}

function parseRoutes(included: Resource[]): Map<string, RouteInfo> {
  const routes = new Map<string, RouteInfo>();
  for (const r of included) {
    if (r.type !== 'route' || SILVER_LINE_IDS.includes(r.id)) continue;
    const mode = routeModeOf(r.attributes?.type);
    if (!mode) continue;
    const a = r.attributes ?? {};
    const longName = a.long_name ?? '';
    routes.set(r.id, {
      id: r.id, source: 'mbta', mode,
      shortName: a.short_name || longName, longName,
      color: `#${a.color}`, textColor: `#${a.text_color}`,
    });
  }
  return routes;
}

function parseTimed(
  json: unknown, live: boolean,
): { departures: Departure[]; routes: RouteInfo[] } {
  const doc = asDoc(json);
  const included = doc.included ?? [];
  const routes = parseRoutes(included);
  const trips = new Map(included.filter((r) => r.type === 'trip').map((r) => [r.id, r]));
  const vehicles = new Map(included.filter((r) => r.type === 'vehicle').map((r) => [r.id, r]));
  const departures: Departure[] = [];
  for (const p of doc.data ?? []) {
    const a = p.attributes ?? {};
    if (!a.departure_time) continue;
    if (a.schedule_relationship === 'CANCELLED' || a.schedule_relationship === 'SKIPPED') continue;
    const routeId = rel(p, 'route');
    const route = routeId ? routes.get(routeId) : undefined;
    if (!route) continue;
    const tripId = rel(p, 'trip');
    const stopId = rel(p, 'stop') ?? '';
    const d: Departure = {
      source: 'mbta', mode: route.mode, routeId: route.id, stopId,
      directionKey: `${route.id}:${a.direction_id}`,
      headsign: (tripId && trips.get(tripId)?.attributes?.headsign) || '',
      departureTime: Date.parse(a.departure_time),
      live, tripId,
    };
    if (a.arrival_time) d.arrivalTime = Date.parse(a.arrival_time);
    if (live) {
      if (a.status) d.status = a.status;
      const v = vehicles.get(rel(p, 'vehicle') ?? '');
      d.vehicleStoppedHere = v?.attributes?.current_status === 'STOPPED_AT' && rel(v, 'stop') === stopId;
    }
    departures.push(d);
  }
  return { departures, routes: [...routes.values()] };
}

// ---- predictions ----

export function predictionsUrl(cfg: Config, platformIds: string[]): string {
  return url(cfg, 'predictions', {
    'filter[stop]': platformIds.join(','),
    include: 'route,trip,vehicle',
    'fields[prediction]': 'departure_time,arrival_time,direction_id,status,schedule_relationship,stop_sequence',
    'fields[trip]': 'headsign',
    'fields[route]': 'short_name,long_name,color,text_color,type',
    'fields[vehicle]': 'current_status,stop',
  });
}

export function parsePredictions(json: unknown, _nowMs: number): { departures: Departure[]; routes: RouteInfo[] } {
  return parseTimed(json, true);
}

// ---- schedules ----

const pad2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (minutes: number) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

/** Next 60 minutes, expressed relative to the service date (so 00:30 after midnight is "24:30"). */
export function schedulesUrl(cfg: Config, platformIds: string[], nowMs: number): string {
  const sd = serviceDate(nowMs);
  const minutes = Math.floor((nowMs - gtfsTimeToEpoch(sd, '00:00:00')) / 60_000);
  return url(cfg, 'schedules', {
    'filter[stop]': platformIds.join(','),
    'filter[date]': `${sd.slice(0, 4)}-${sd.slice(4, 6)}-${sd.slice(6, 8)}`,
    'filter[min_time]': hhmm(minutes),
    'filter[max_time]': hhmm(minutes + 60),
    include: 'route,trip',
    'fields[schedule]': 'departure_time,arrival_time,direction_id,stop_sequence',
    'fields[trip]': 'headsign',
    'fields[route]': 'short_name,long_name,color,text_color,type',
  });
}

export function parseSchedules(json: unknown): { departures: Departure[]; routes: RouteInfo[] } {
  return parseTimed(json, false);
}

// ---- alerts ----

/** MBTA ANDs filter[route] with filter[stop]; pass only one list per request unless that is intended. */
export function alertsUrl(cfg: Config, routeIds: string[], stopIds: string[]): string {
  const q: Record<string, string> = {};
  if (routeIds.length) q['filter[route]'] = routeIds.join(',');
  if (stopIds.length) q['filter[stop]'] = stopIds.join(',');
  q['fields[alert]'] = 'header,effect,informed_entity';
  return url(cfg, 'alerts', q);
}

export function parseAlerts(json: unknown): Alert[] {
  const out: Alert[] = [];
  for (const a of asDoc(json).data ?? []) {
    const attrs = a.attributes ?? {};
    if (!SHOWN_EFFECTS.includes(attrs.effect)) continue;
    const entities: Array<{ route?: string; stop?: string }> = attrs.informed_entity ?? [];
    const uniq = (xs: Array<string | undefined>) => [...new Set(xs.filter((x): x is string => !!x))];
    out.push({
      id: a.id, source: 'mbta', header: attrs.header ?? '',
      routeIds: uniq(entities.map((e) => e.route)), stopIds: uniq(entities.map((e) => e.stop)),
    });
  }
  return out;
}
