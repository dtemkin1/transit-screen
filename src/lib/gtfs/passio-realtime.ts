import type { Alert, Departure } from '../types';
import type { PassioStatic } from './passio-static';

export function passioRealtimeUrl(
  agency: 'mit' | 'charlesriver',
  feed: 'tripUpdates' | 'serviceAlerts',
): string {
  return `https://passio3.com/${agency}/passioTransit/gtfs/realtime/${feed}.json`;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function epochMs(v: unknown): number | null {
  const raw = obj(v).time;
  const n = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(n) ? n * 1000 : null;
}

// schedule_relationship arrives as a name or as the numeric enum (1 SKIPPED, 2 NO_DATA).
function isUnserved(rel: unknown): boolean {
  return rel === 'SKIPPED' || rel === 'NO_DATA' || rel === 1 || rel === 2 || rel === '1' || rel === '2';
}

// TripDescriptor enum: SCHEDULED 0, ADDED 1, UNSCHEDULED 2, CANCELED 3, DELETED 7.
function isCanceled(rel: unknown): boolean {
  return rel === 'CANCELED' || rel === 'DELETED' || rel === 3 || rel === 7 || rel === '3' || rel === '7';
}

export function parseTripUpdates(
  json: unknown, s: PassioStatic, stopIds: Set<string>, nowMs: number,
): Departure[] {
  const out: Departure[] = [];
  for (const entity of arr(obj(json).entity)) {
    const tu = obj(obj(entity).trip_update);
    const trip = obj(tu.trip);
    if (isCanceled(trip.schedule_relationship)) continue;
    const tripId = String(trip.trip_id ?? '');
    const staticTrip = s.trips.get(tripId);
    const routeId = staticTrip?.routeId ?? String(trip.route_id ?? '');
    if (!routeId) continue;
    const headsign = staticTrip?.headsign || s.routes.get(routeId)?.longName || 'Shuttle';
    const vehicleId = obj(tu.vehicle).id;
    const last = s.stopTimes.get(tripId)?.at(-1);
    for (const u of arr(tu.stop_time_update)) {
      const stu = obj(u);
      const stopId = String(stu.stop_id ?? '');
      if (!stopIds.has(stopId) || isUnserved(stu.schedule_relationship)) continue;
      // No boarding at a trip's final stop (matches scheduledDepartures); sequence disambiguates loops.
      if (last && last.stopId === stopId && (stu.stop_sequence == null || Number(stu.stop_sequence) === last.seq)) continue;
      const arrival = epochMs(stu.arrival);
      const t = epochMs(stu.departure) ?? arrival;
      if (t === null || t < nowMs) continue;
      out.push({
        source: s.source, mode: s.mode, routeId, stopId,
        directionKey: `${routeId}:${headsign}`, headsign,
        departureTime: t, ...(arrival !== null && { arrivalTime: arrival }),
        live: true, tripId,
        ...(vehicleId != null && vehicleId !== '' && { vehicleId: String(vehicleId) }),
      });
    }
  }
  return out.sort((a, b) => a.departureTime - b.departureTime);
}

export function parseServiceAlerts(json: unknown, source: 'mit' | 'ezride'): Alert[] {
  const out: Alert[] = [];
  arr(obj(json).entity).forEach((entity, i) => {
    const e = obj(entity);
    const alert = obj(e.alert);
    const header = obj(arr(obj(alert.header_text).translation)[0]).text;
    if (typeof header !== 'string' || !header) return;
    const informed = arr(alert.informed_entity).map(obj);
    const ids = (k: string) => informed.flatMap((x) => (x[k] != null ? [String(x[k])] : []));
    out.push({
      id: String(e.id ?? i), source, header,
      routeIds: ids('route_id'), stopIds: ids('stop_id'),
    });
  });
  return out;
}
