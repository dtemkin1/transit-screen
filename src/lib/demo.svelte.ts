/**
 * Development-only sample data (`?demo` on the dev server) that puts every state the board can
 * show on screen at once, for checking the design without waiting for live data to produce it:
 *   ?demo          alerts, MBTA status text, a delayed feed, schedule fallback, long names,
 *                  a closed dock, a dock with no data, and a shuttle color with no text color.
 *   ?demo=outage   MBTA and EZRide down with no schedule ("Live data unavailable").
 *   ?demo=loading  before discovery ("Finding nearby transit…").
 * App only imports this under import.meta.env.DEV, so it is not in production builds.
 */
import type { Discovered } from './discovery';
import type { PollerState } from './poller.svelte';
import type { BikeStation, Departure, Mode, RouteInfo, Source, Stop } from './types';

const MIN = 60_000;

const stop = (source: Source, mode: Mode, id: string, name: string, walkSec: number): Stop => ({
  id, source, mode, name, lat: 0, lon: 0, platformIds: [id], walkSec, walkEstimated: false,
});
const route = (source: Source, mode: Mode, id: string, shortName: string, longName: string, color: string, textColor: string): RouteInfo =>
  ({ id, source, mode, shortName, longName, color, textColor });

const STOPS: Stop[] = [
  stop('mbta', 'subway', 'place-knncl', 'Kendall/MIT', 660),
  stop('mbta', 'subway', 'place-cntsq', 'Central', 780),
  stop('mbta', 'bus', 'b-albany', 'Massachusetts Ave @ Albany St', 135),
  stop('mbta', 'bus', 'b-sidney', 'Massachusetts Ave @ Sidney St', 401),
  stop('mbta', 'bus', 'b-vassar', 'Vassar St @ Massachusetts Ave', 97),
  stop('ezride', 'ezride', 'e-vassar', 'Vassar/Mass Ave. OB', 120),
  stop('mit', 'shuttle', 'm-vassar', 'Vassar @ Mass Ave', 110),
  stop('mit', 'shuttle', 'm-77', '77 Massachusetts Ave', 150),
];
const ROUTES: RouteInfo[] = [
  route('mbta', 'subway', 'Red', '', 'Red Line', '#DA291C', '#FFFFFF'),
  route('mbta', 'bus', '1', '1', 'Harvard Square - Nubian Station', '#FFC72C', '#000000'),
  route('mbta', 'bus', '70', '70', 'Cedarwood - University Park', '#FFC72C', '#000000'),
  route('mbta', 'bus', '85', '85', 'Spring Hill - Kendall/MIT', '#FFC72C', '#000000'),
  route('ezride', 'ezride', '6448', 'EZRide', 'Evening Shuttle', '#91268E', '#FFFFFF'),
  route('mit', 'shuttle', 'ts', 'Tech Shuttle', 'Tech Shuttle', '#843C39', '#FFFFFF'),
  // Passio publishes this one with no text color: the badge must still pick a readable one.
  route('mit', 'shuttle', 'sca', 'Saferide Cambridge All', 'Saferide Cambridge All', '#E377C2', ''),
];

function departures(now: number): { live: Departure[]; scheduled: Departure[] } {
  let n = 0;
  const dep = (source: Source, routeId: string, stopId: string, dir: string, headsign: string, min: number,
    o: Partial<Departure> = {}): Departure => {
    const mode = ROUTES.find((r) => r.source === source && r.id === routeId)!.mode;
    return {
      source, mode, routeId, stopId, headsign, live: true, tripId: `demo-${n++}`,
      directionKey: source === 'mbta' ? `${routeId}:${dir}` : `${routeId}:${headsign}`,
      departureTime: now + min * MIN, ...o,
    };
  };
  const live = [
    ...[12, 19, 27].map((m) => dep('mbta', 'Red', 'place-knncl', '1', 'Alewife', m)),
    ...[15, 23].map((m) => dep('mbta', 'Red', 'place-knncl', '0', 'Ashmont', m)),
    dep('mbta', 'Red', 'place-knncl', '0', 'Braintree', 13, { status: 'Stopped 5 stops away' }),
    dep('mbta', 'Red', 'place-knncl', '0', 'Braintree', 29),
    ...[14, 22, 31].map((m) => dep('mbta', 'Red', 'place-cntsq', '1', 'Alewife', m)),
    ...[17, 25].map((m) => dep('mbta', 'Red', 'place-cntsq', '0', 'Ashmont', m)),
    ...[4, 16, 30].map((m) => dep('mbta', '1', 'b-albany', '0', 'Harvard', m)),
    ...[8, 21].map((m) => dep('mbta', '1', 'b-albany', '1', 'Nubian', m)),
    ...[9, 24].map((m) => dep('mbta', '70', 'b-sidney', '0', 'University Park', m)),
    dep('mbta', '85', 'b-vassar', '0', 'Spring Hill via Union Square and Somerville Avenue', 3, { status: 'Approaching' }),
    dep('mbta', '85', 'b-vassar', '0', 'Spring Hill via Union Square and Somerville Avenue', 33),
    ...[3, 18].map((m) => dep('mit', 'ts', 'm-vassar', '', 'Kendall Square T', m)),
    dep('mit', 'sca', 'm-77', '', 'Simmons Hall', 11),
  ];
  const scheduled = [6, 26].map((m) => dep('ezride', '6448', 'e-vassar', '', 'North Station', m, { live: false }));
  return { live, scheduled };
}

const BIKES: BikeStation[] = [
  { id: 'a', name: 'Mass Ave at Albany St', lat: 0, lon: 0, walkSec: 220, bikes: 3, ebikes: 2, docks: 15, renting: true },
  { id: 'b', name: 'MIT at Mass Ave / Amherst St', lat: 0, lon: 0, walkSec: 247, bikes: 0, ebikes: 0, docks: 28, renting: true },
  { id: 'c', name: 'MIT Stata Center at Vassar St / Main St', lat: 0, lon: 0, walkSec: 353, renting: false, bikes: 0, docks: 0 },
  { id: 'd', name: 'University Park', lat: 0, lon: 0, walkSec: 452 },
];

export function createDemoPoller(kind: string) {
  const start0 = Date.now();
  const empty = () => ({ mbta: [], mit: [], ezride: [], bluebikes: [] });
  const ago = (ms: number) => ({ lastOk: start0 - ms });
  const { live, scheduled } = departures(start0);
  const outage = kind === 'outage';
  const bySource = (ds: Departure[]) => {
    const out: Record<Source, Departure[]> = empty();
    for (const d of ds) out[d.source].push(d);
    return out;
  };
  const discovered: Discovered = {
    stops: STOPS, bikes: BIKES, routes: new Map(ROUTES.map((r) => [`${r.source}:${r.id}`, r])), passio: {},
  };

  const state: PollerState = $state({
    discovered: kind === 'loading' ? undefined : discovered,
    live: outage ? { ...bySource(live), mbta: [], ezride: [] } : bySource(live),
    scheduled: outage ? empty() : bySource(scheduled),
    health: outage
      ? { mbta: ago(15 * MIN), mit: ago(0), ezride: ago(15 * MIN), bluebikes: ago(0) }
      : { mbta: ago(0), mit: ago(3 * MIN), ezride: ago(11 * MIN), bluebikes: ago(0) },
    alerts: [
      { id: 'a1', source: 'mbta', routeIds: ['Red'], stopIds: [],
        header: 'Red Line: Shuttle buses replace trains between JFK/UMass and Ashmont after 9 PM tonight.' },
      { id: 'a2', source: 'mbta', routeIds: ['1'], stopIds: [],
        header: 'Route 1 is detoured in both directions between Massachusetts Ave @ Albany St and Central Square because of utility work on Massachusetts Ave. Expect delays of up to 10 minutes; buses stop at temporary stops on Main St.' },
    ],
    bikes: BIKES,
    extraRoutes: [],
    now: start0,
  });

  // Time runs as normal (countdowns tick down); the sample data stays fixed.
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    state,
    start() { timer = setInterval(() => (state.now = Date.now()), 5_000); },
    stop() { clearInterval(timer); },
  };
}
