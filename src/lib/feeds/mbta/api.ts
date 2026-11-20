import type { Config } from '../../../config';
import { candidateRadiusM, metresToRadiusDegrees } from '../../util/geo';
import { gtfsTimeToEpoch, serviceDate } from '../../util/time';
import type { Alert, Departure, Mode, RouteInfo, Source, Stop } from '../../types';
import { workerUrl } from '../../data/worker-client';

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

export function stopsUrl(cfg: Config, mode: 'subway' | 'bus', maxWalkMin: number): string {
  const radius = metresToRadiusDegrees(candidateRadiusM(maxWalkMin, cfg), cfg.location.lat).toFixed(5);
  return url(cfg, 'stops', {
    'filter[latitude]': String(cfg.location.lat),
    'filter[longitude]': String(cfg.location.lon),
    'filter[radius]': radius,
    'filter[route_type]': mode === 'subway' ? '0,1' : '3',
    include: 'parent_station',
    'fields[stop]': 'name,latitude,longitude',
  });
}

export function parseStops(json: unknown, mode: 'subway' | 'bus', source: Source = 'mbta'): Stop[] {
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
      id: anchor.id, source, mode,
      name: anchor.attributes?.name ?? '',
      lat: anchor.attributes?.latitude, lon: anchor.attributes?.longitude,
      platformIds: [s.id], walkSec: 0, walkEstimated: false,
    });
  }
  return [...out.values()];
}


function routeModeOf(type: unknown): Mode | undefined {
  if (type === 0 || type === 1) return 'subway';
  if (type === 3) return 'bus';
  return undefined;
}

function parseRoutes(included: Resource[], source: Source): Map<string, RouteInfo> {
  const routes = new Map<string, RouteInfo>();
  for (const r of included) {
    if (r.type !== 'route' || SILVER_LINE_IDS.includes(r.id)) continue;
    const mode = routeModeOf(r.attributes?.type);
    if (!mode) continue;
    const a = r.attributes ?? {};
    const longName = a.long_name ?? '';
    routes.set(r.id, {
      id: r.id, source, mode,
      shortName: a.short_name || longName, longName,
      color: `#${a.color}`, textColor: `#${a.text_color}`,
    });
  }
  return routes;
}

function parseTimed(
  json: unknown, live: boolean, source: Source,
): { departures: Departure[]; routes: RouteInfo[] } {
  const doc = asDoc(json);
  const included = doc.included ?? [];
  const routes = parseRoutes(included, source);
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
      source, mode: route.mode, routeId: route.id, stopId,
      directionKey: `${route.id}:${a.direction_id}`,
      headsign: (tripId && trips.get(tripId)?.attributes?.headsign) || '',
      departureTime: Date.parse(a.departure_time),
      live, tripId,
    };
    if (a.arrival_time) d.arrivalTime = Date.parse(a.arrival_time);
    if (live) {
      if (a.status) d.status = a.status;
      const vehicleId = rel(p, 'vehicle');
      if (vehicleId) d.vehicleId = vehicleId;
      const v = vehicles.get(vehicleId ?? '');
      d.vehicleStoppedHere = v?.attributes?.current_status === 'STOPPED_AT' && rel(v, 'stop') === stopId;
    }
    departures.push(d);
  }
  return { departures, routes: [...routes.values()] };
}

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

export function parsePredictions(json: unknown, source: Source = 'mbta'): { departures: Departure[]; routes: RouteInfo[] } {
  return parseTimed(json, true, source);
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (minutes: number) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
const isoDate = (sd: string) => `${sd.slice(0, 4)}-${sd.slice(4, 6)}-${sd.slice(6, 8)}`;

/** Routes serving any of `platformIds` in one direction on service date `sd`, whatever the hour. */
export function routesUrl(cfg: Config, platformIds: string[], sd: string, directionId: 0 | 1, mode: 'subway' | 'bus'): string {
  return url(cfg, 'routes', {
    'filter[stop]': platformIds.join(','),
    'filter[date]': isoDate(sd),
    'filter[direction_id]': String(directionId),
    'filter[type]': mode === 'subway' ? '0,1' : '3',
    'fields[route]': 'type',
  });
}

/** The route patterns serving any of `platformIds` on service date `sd`, with each one's route type and destination. */
export function routePatternsUrl(cfg: Config, platformIds: string[], sd: string): string {
  return url(cfg, 'route_patterns', {
    'filter[stop]': platformIds.join(','),
    'filter[date]': isoDate(sd),
    include: 'route,representative_trip',
    'fields[route_pattern]': 'direction_id',
    'fields[route]': 'type',
    'fields[trip]': 'headsign',
  });
}

/**
 * Each route and destination once, as subway rows are keyed ("Red" to "Braintree"): a direction can
 * split by branch. The Silver Line is left out, as it is from departures.
 */
export function parseServiceDestinations(json: unknown): { id: string; mode: Mode; headsign: string }[] {
  const doc = asDoc(json);
  const included = new Map((doc.included ?? []).map((r) => [`${r.type}:${r.id}`, r]));
  const out = new Map<string, { id: string; mode: Mode; headsign: string }>();
  for (const p of doc.data ?? []) {
    const id = rel(p, 'route') ?? '';
    const mode = routeModeOf(included.get(`route:${id}`)?.attributes?.type);
    const headsign = included.get(`trip:${rel(p, 'representative_trip')}`)?.attributes?.headsign;
    if (!mode || !headsign || SILVER_LINE_IDS.includes(id)) continue;
    out.set(`${id}:${headsign}`, { id, mode, headsign });
  }
  return [...out.values()];
}

/** The board's modes only; the Silver Line is left out here as it is from departures. */
export function parseServiceRoutes(json: unknown): { id: string; mode: Mode }[] {
  return (asDoc(json).data ?? []).flatMap((r) => {
    const mode = routeModeOf(r.attributes?.type);
    return r.type === 'route' && mode && !SILVER_LINE_IDS.includes(r.id) ? [{ id: r.id, mode }] : [];
  });
}

/** Next 60 minutes, expressed relative to the service date (so 00:30 after midnight is "24:30"). */
export function schedulesUrl(cfg: Config, platformIds: string[], nowMs: number): string {
  const sd = serviceDate(nowMs);
  const minutes = Math.floor((nowMs - gtfsTimeToEpoch(sd, '00:00:00')) / 60_000);
  return url(cfg, 'schedules', {
    'filter[stop]': platformIds.join(','),
    'filter[date]': isoDate(sd),
    'filter[min_time]': hhmm(minutes),
    'filter[max_time]': hhmm(minutes + 60),
    include: 'route,trip',
    'fields[schedule]': 'departure_time,arrival_time,direction_id,stop_sequence',
    'fields[trip]': 'headsign',
    'fields[route]': 'short_name,long_name,color,text_color,type',
  });
}

export function parseSchedules(json: unknown, source: Source = 'mbta'): { departures: Departure[]; routes: RouteInfo[] } {
  return parseTimed(json, false, source);
}

/** MBTA ANDs filter[route] with filter[stop]; pass only one list per request unless that is intended. */
export function alertsUrl(cfg: Config, routeIds: string[], stopIds: string[]): string {
  const q: Record<string, string> = {};
  if (routeIds.length) q['filter[route]'] = routeIds.join(',');
  if (stopIds.length) q['filter[stop]'] = stopIds.join(',');
  q['filter[activity]'] = 'BOARD,EXIT,RIDE';
  q['filter[datetime]'] = 'NOW';
  q['fields[alert]'] = 'header,effect,informed_entity';
  return url(cfg, 'alerts', q);
}

export function parseAlerts(json: unknown, source: Source = 'mbta'): Alert[] {
  const out: Alert[] = [];
  for (const a of asDoc(json).data ?? []) {
    const attrs = a.attributes ?? {};
    if (!SHOWN_EFFECTS.includes(attrs.effect)) continue;
    const entities: Array<{ route?: string; stop?: string }> = attrs.informed_entity ?? [];
    const uniq = (xs: Array<string | undefined>) => [...new Set(xs.filter((x): x is string => !!x))];
    out.push({
      id: a.id, source, header: attrs.header ?? '',
      routeIds: uniq(entities.map((e) => e.route)), stopIds: uniq(entities.map((e) => e.stop)),
    });
  }
  return out;
}
