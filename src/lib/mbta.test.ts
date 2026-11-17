import { describe, expect, it, vi, afterEach } from 'vitest';
import { defaultConfig } from '../config';
import { metresToRadiusDegrees } from './geo';
import {
  SHOWN_EFFECTS, alertsUrl, chunk, fetchMbtaCandidates, parseAlerts, parsePredictions, parseSchedules,
  parseStops, predictionsUrl, schedulesUrl, stopsUrl,
} from './mbta';
import stopsSubway from '../test/fixtures/mbta-stops-subway.json';
import stopsBus from '../test/fixtures/mbta-stops-bus.json';
import predictions from '../test/fixtures/mbta-predictions.json';
import schedules from '../test/fixtures/mbta-schedules.json';
import alerts from '../test/fixtures/mbta-alerts.json';

const cfg = { ...defaultConfig, workerUrl: 'https://w.example' };
const NOW = Date.parse('2026-11-17T18:45:00-05:00');

describe('stops', () => {
  it('groups subway platforms under parent station', () => {
    const stops = parseStops(stopsSubway, 'subway');
    const kendall = stops.find((s) => s.id === 'place-knncl')!;
    expect(kendall.platformIds).toEqual(expect.arrayContaining(['70071', '70072']));
    expect(kendall.name).toBe('Kendall/MIT');
    expect(kendall).toMatchObject({ source: 'mbta', mode: 'subway', walkSec: 0, walkEstimated: false });
    expect(stops.map((s) => s.id).sort()).toEqual(['place-cntsq', 'place-knncl']);
    expect(kendall.lat).toBeCloseTo(42.36249, 3);
  });

  it('bus stops are their own platform', () => {
    const stops = parseStops(stopsBus, 'bus');
    expect(stops).toHaveLength(3);
    for (const s of stops) expect(s.platformIds).toEqual([s.id]);
    expect(stops[0]).toMatchObject({ mode: 'bus', source: 'mbta' });
  });

  it('radius in degrees', () => {
    const url = new URL(stopsUrl(cfg, 'subway'));
    expect(url.pathname).toBe('/mbta/stops');
    expect(url.searchParams.get('filter[radius]')).toBe(metresToRadiusDegrees(1170, 42.35982).toFixed(5));
    expect(url.searchParams.get('filter[route_type]')).toBe('0,1');
    expect(url.searchParams.get('include')).toBe('parent_station');
    expect(url.searchParams.get('filter[latitude]')).toBe('42.35982');
    expect(new URL(stopsUrl(cfg, 'bus')).searchParams.get('filter[route_type]')).toBe('3');
    expect(new URL(stopsUrl(cfg, 'bus')).searchParams.get('filter[radius]')).toBe(metresToRadiusDegrees(390, 42.35982).toFixed(5));
  });
});

describe('fetchMbtaCandidates', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('fetches both modes and fills routes empty', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.includes('route_type]=3') ? stopsBus : stopsSubway)));
    vi.stubGlobal('fetch', fetchMock);
    const c = await fetchMbtaCandidates(cfg);
    expect(c.subway).toHaveLength(2);
    expect(c.bus).toHaveLength(3);
    expect(c.routes.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('predictions', () => {
  const { departures, routes } = parsePredictions(predictions, NOW);
  const byTrip = (id: string, stop?: string) =>
    departures.find((d) => d.tripId === id && (!stop || d.stopId === stop))!;

  it('drops cancelled, skipped and null departure_time', () => {
    expect(byTrip('77871162')).toBeUndefined();
    expect(byTrip('77871346')).toBeUndefined();
    expect(byTrip('77871347')).toBeUndefined();
    expect(departures).toHaveLength(6);
  });

  it('sets vehicleStoppedHere only for STOPPED_AT at the same stop', () => {
    expect(byTrip('77871340', '70072').vehicleStoppedHere).toBe(true);
    expect(byTrip('77871453', '70071').vehicleStoppedHere).toBe(false);
    // bus vehicle is STOPPED_AT stop 188, not 97
    expect(byTrip('78182098', '97').vehicleStoppedHere).toBe(false);
  });

  it('headsign from trip, directionKey route:dir', () => {
    const d = byTrip('77871340', '70072');
    expect(d).toMatchObject({
      routeId: 'Red', directionKey: 'Red:1', headsign: 'Alewife', live: true, source: 'mbta', mode: 'subway',
      departureTime: Date.parse('2026-11-17T18:54:13-05:00'), arrivalTime: Date.parse('2026-11-17T18:53:00-05:00'),
    });
    expect(byTrip('77871453', '70071')).toMatchObject({ directionKey: 'Red:0', headsign: 'Braintree' });
  });

  it('passes status text through verbatim', () => {
    expect(byTrip('77871182', '70071').status).toBe('Boarding');
    expect(byTrip('77871340', '70072').status).toBeUndefined();
  });

  it('returns routes with mode, short name fallback and # colors', () => {
    const red = routes.find((r) => r.id === 'Red')!;
    expect(red).toEqual({
      id: 'Red', source: 'mbta', mode: 'subway', shortName: 'Red Line', longName: 'Red Line',
      color: '#DA291C', textColor: '#FFFFFF',
    });
    const bus = routes.find((r) => r.id === '85')!;
    expect(bus).toMatchObject({ mode: 'bus', shortName: '85', color: '#FFC72C' });
    expect(byTrip('78174236').mode).toBe('bus');
  });

  it('excludes Silver Line and rail/ferry routes', () => {
    const json = structuredClone(predictions) as any;
    json.included.push(
      { type: 'route', id: '741', attributes: { short_name: 'SL1', long_name: 'x', color: '7C878E', text_color: 'FFFFFF', type: 3 } },
      { type: 'route', id: 'CR-Fitchburg', attributes: { short_name: '', long_name: 'Fitchburg', color: '80276C', text_color: 'FFFFFF', type: 2 } },
    );
    for (const [i, r] of [[0, '741'], [1, 'CR-Fitchburg']] as const) {
      const p = structuredClone(json.data.find((x: any) => x.id === 'prediction-77871453-70071-50-Red'));
      p.id = `extra-${i}`;
      p.relationships.route.data.id = r;
      json.data.push(p);
    }
    const out = parsePredictions(json, NOW);
    expect(out.departures.some((d) => d.routeId === '741' || d.routeId === 'CR-Fitchburg')).toBe(false);
    expect(out.routes.map((r) => r.id).sort()).toEqual(['1', '85', 'Red']);
  });

  it('url lists platforms and sparse fields', () => {
    const url = new URL(predictionsUrl(cfg, ['70071', '70072']));
    expect(url.pathname).toBe('/mbta/predictions');
    expect(url.searchParams.get('filter[stop]')).toBe('70071,70072');
    expect(url.searchParams.get('include')).toBe('route,trip,vehicle');
    expect(url.searchParams.get('fields[vehicle]')).toBe('current_status,stop');
  });
});

describe('schedules', () => {
  it('parses live=false departures and routes', () => {
    const { departures, routes } = parseSchedules(schedules);
    expect(departures).toHaveLength(6);
    expect(departures[0]).toMatchObject({
      live: false, routeId: 'Red', stopId: '70071', directionKey: 'Red:0', source: 'mbta', mode: 'subway',
      departureTime: Date.parse('2026-11-17T19:24:00-05:00'),
    });
    expect(departures[0].headsign).toBeTruthy();
    expect(departures[1].arrivalTime).toBeUndefined();
    expect(routes.map((r) => r.id).sort()).toEqual(['1', 'Red']);
  });

  it('drops schedule entries with no departure_time', () => {
    const json = structuredClone(schedules) as any;
    json.data[0].attributes.departure_time = null;
    expect(parseSchedules(json).departures).toHaveLength(5);
  });

  it('url: service date and 60 min window as HH:MM', () => {
    const url = new URL(schedulesUrl(cfg, ['70071'], Date.parse('2026-11-17T19:07:30-05:00')));
    expect(url.pathname).toBe('/mbta/schedules');
    expect(url.searchParams.get('filter[date]')).toBe('2026-11-17');
    expect(url.searchParams.get('filter[min_time]')).toBe('19:07');
    expect(url.searchParams.get('filter[max_time]')).toBe('20:07');
    expect(url.searchParams.get('include')).toBe('route,trip');
  });

  it('url: after midnight uses previous service date and 24+ hours', () => {
    const url = new URL(schedulesUrl(cfg, ['70071'], Date.parse('2026-11-18T00:30:00-05:00')));
    expect(url.searchParams.get('filter[date]')).toBe('2026-11-17');
    expect(url.searchParams.get('filter[min_time]')).toBe('24:30');
    expect(url.searchParams.get('filter[max_time]')).toBe('25:30');
  });
});

describe('alerts', () => {
  it('filtered by effect', () => {
    const out = parseAlerts(alerts);
    expect(out.map((a) => a.id)).toEqual(['1046031', '1046033']);
    expect(out[0]).toEqual({
      id: '1046031', source: 'mbta', header: 'Route 85 is experiencing delays of about 20 minutes due to traffic.',
      routeIds: ['85'], stopIds: [],
    });
    expect(out[1]).toMatchObject({ routeIds: ['1'], stopIds: ['97'] });
    expect(SHOWN_EFFECTS).toContain('DELAY');
    expect(SHOWN_EFFECTS).not.toContain('ELEVATOR_CLOSURE');
  });

  it('url sends only the non-empty filters', () => {
    const a = new URL(alertsUrl(cfg, ['Red', '85'], []));
    expect(a.pathname).toBe('/mbta/alerts');
    expect(a.searchParams.get('filter[route]')).toBe('Red,85');
    expect(a.searchParams.has('filter[stop]')).toBe(false);
    const b = new URL(alertsUrl(cfg, [], ['97']));
    expect(b.searchParams.get('filter[stop]')).toBe('97');
    expect(b.searchParams.has('filter[route]')).toBe(false);
  });
});

describe('chunk', () => {
  it('splits at 100', () => {
    const ids = Array.from({ length: 250 }, (_, i) => String(i));
    expect(chunk(ids, 100).map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunk([], 100)).toEqual([]);
  });
});
