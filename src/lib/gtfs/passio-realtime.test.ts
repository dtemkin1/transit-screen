import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parsePassioZip } from './passio-static';
import { parseServiceAlerts, parseTripUpdates, passioRealtimeUrl } from './passio-realtime';
import tripUpdates from '../../test/fixtures/passio-mit-tripUpdates.json';
import liveAlerts from '../../test/fixtures/passio-mit-serviceAlerts.json';
import alertsRt from '../../test/fixtures/passio-mit-serviceAlerts.gtfsrt.json';

const files: Record<string, string> = {
  'routes.txt': 'route_id,route_short_name,route_long_name,route_color,route_text_color\n63220,,Tech Shuttle,,\n56140,,Boston West,,\n',
  'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\n988,Stop 988,42.1,-71.1\n1018,Stop 1018,42.2,-71.2\n',
  'trips.txt': 'route_id,service_id,trip_id,trip_headsign\n63220,WK,913997,Kendall\n',
  'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n913997,07:00:00,07:00:00,988,1\n913997,07:10:00,07:10:00,1018,2\n',
  'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260101,20271231\n',
};
const s = parsePassioZip(
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))), 'mit', 'shuttle',
);
const now = 1794958600 * 1000;
const all = new Set(['988', '1018', '1023', '47096']);

describe('parseTripUpdates', () => {
  it('maps stop_time_update to Departure in ms', () => {
    const d = parseTripUpdates(tripUpdates, s, all, now);
    expect(d[0]).toMatchObject({
      source: 'mit', mode: 'shuttle', routeId: '63220', stopId: '988', tripId: '913997',
      headsign: 'Kendall', directionKey: '63220:Kendall', live: true,
      departureTime: 1794958670 * 1000, arrivalTime: 1794958669 * 1000,
      vehicleId: '3009',
    });
  });
  it('filters to discovered stops', () => {
    const d = parseTripUpdates(tripUpdates, s, new Set(['988']), now);
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((x) => x.stopId === '988')).toBe(true);
  });
  it('unknown trip falls back to route long name', () => {
    const d = parseTripUpdates(tripUpdates, s, new Set(['988']), now).find((x) => x.tripId === '999999')!;
    expect(d.headsign).toBe('Tech Shuttle');
    expect(d.directionKey).toBe('63220:Tech Shuttle');
  });
  it('falls back to "Shuttle" when the route is unknown too', () => {
    const d = parseTripUpdates(tripUpdates, s, new Set(['47096']), now);
    expect(d[0].headsign).toBe('Boston West');
    const bare = parseTripUpdates(tripUpdates, { ...s, routes: new Map(), trips: new Map() }, new Set(['47096']), now);
    expect(bare[0].headsign).toBe('Shuttle');
  });
  it('drops departures before now', () => {
    const cutoff = 1794958671 * 1000;
    const d = parseTripUpdates(tripUpdates, s, new Set(['988']), cutoff);
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((x) => x.departureTime >= cutoff)).toBe(true);
  });
  it('skips SKIPPED/NO_DATA stops (string or numeric), uses arrival when no departure, coerces strings', () => {
    const json = {
      entity: [{
        trip_update: {
          trip: { trip_id: '913997', route_id: '63220' },
          stop_time_update: [
            { stop_id: '988', schedule_relationship: 'SKIPPED', departure: { time: 1794959000 } },
            { stop_id: '988', schedule_relationship: 2, departure: { time: 1794959001 } },
            { stop_id: '988', schedule_relationship: 1, departure: { time: 1794959002 } },
            { stop_id: '988', arrival: { time: '1794959003' } },
          ],
        },
      }, {
        trip_update: {
          trip: { trip_id: '913997', route_id: '63220', schedule_relationship: 'SKIPPED' },
          stop_time_update: [{ stop_id: '988', departure: { time: 1794959004 } }],
        },
      }],
    };
    const d = parseTripUpdates(json, s, new Set(['988']), now);
    expect(d.map((x) => x.departureTime)).toEqual([1794959003 * 1000, 1794959004 * 1000]);
  });
  it('drops CANCELED/DELETED trips (string or numeric) but keeps ADDED/UNSCHEDULED', () => {
    const mk = (rel: unknown, time: number) => ({
      trip_update: {
        trip: { trip_id: '913997', route_id: '63220', schedule_relationship: rel },
        stop_time_update: [{ stop_id: '988', departure: { time } }],
      },
    });
    const rels = ['CANCELED', 'DELETED', 3, 7, '3', 'ADDED', 'UNSCHEDULED', 1, 2, 0, 'SCHEDULED'];
    const json = { entity: rels.map((r, i) => mk(r, 1794959100 + i)) };
    const d = parseTripUpdates(json, s, new Set(['988']), now);
    expect(d.map((x) => x.departureTime)).toEqual(
      [5, 6, 7, 8, 9, 10].map((i) => (1794959100 + i) * 1000),
    );
  });
  it('emits no departure at the final stop of a known trip', () => {
    expect(parseTripUpdates(tripUpdates, s, new Set(['1018']), now)).toEqual([]);
  });
  it('matches the final stop by sequence so loop trips still depart from the first stop', () => {
    const loop = { ...s, stopTimes: new Map([['913997', [
      { stopId: '988', seq: 1, dep: '07:00:00' }, { stopId: '988', seq: 13, dep: '07:30:00' },
    ]]]) };
    const d = parseTripUpdates(tripUpdates, loop, new Set(['988']), now).filter((x) => x.tripId === '913997');
    expect(d.map((x) => x.departureTime)).toEqual([1794958670 * 1000]);
  });
  it('tolerates garbage input', () => {
    expect(parseTripUpdates(null, s, all, now)).toEqual([]);
    expect(parseTripUpdates({}, s, all, now)).toEqual([]);
  });
});

describe('parseServiceAlerts', () => {
  it('parses alert header and informed entities', () => {
    expect(parseServiceAlerts(alertsRt, 'mit')).toEqual([
      { id: 'alert-1', source: 'mit', header: 'Tech Shuttle detour at Vassar St', routeIds: ['63220'], stopIds: ['988'] },
    ]);
  });
  it('treats a feed with no entity array as empty', () => {
    expect(parseServiceAlerts(liveAlerts, 'mit')).toEqual([]);
  });
});

describe('passioRealtimeUrl', () => {
  it('builds feed urls', () => {
    expect(passioRealtimeUrl('charlesriver', 'serviceAlerts')).toBe(
      'https://passio3.com/charlesriver/passioTransit/gtfs/realtime/serviceAlerts.json',
    );
  });
});
