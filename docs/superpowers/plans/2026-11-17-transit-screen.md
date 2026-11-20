# Transit Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, unattended lobby departures board for W41 showing nearby Subway, MBTA bus + EZRide, MIT shuttles, and BlueBikes, discovered by walking time, plus a thin Cloudflare Worker.

**Architecture:** Svelte 5 SPA (static, `base: './'`). It discovers nearby stops from a configured lat/lon, polls realtime feeds per source, builds a board model with pure functions, and renders Layout A (landscape/portrait). The Worker (`worker/`) proxies MBTA V3 (injecting the API key), caches the Passio GTFS zips, and caches Valhalla walking-time matrices.

**Tech Stack:** Svelte 5 (runes), Vite 8, TypeScript, Vitest, `fflate` (unzip), Cloudflare Workers + Wrangler. The existing `gtfs-types` / `gbfs-typescript-types` packages are available for reference types.

**Spec:** `docs/superpowers/specs/2026-11-17-transit-screen-design.md`

## Global Constraints

- Static output only. `vite.config.ts` sets `base: './'`, so the site works under any sub-path (GitHub Pages `/transit-screen/`, Athena `~user/…`).
- Worker stays within the free plan: 100k req/day, 10 ms CPU per request, no KV or cron. It uses the Cache API only.
- MBTA API key lives only in the Worker secret `MBTA_API_KEY`. It never appears in the frontend.
- Default location: W41, `{ lat: 42.35982, lon: -71.09610 }`, name `"W41"`.
- Walk limits (minutes): subway 15, bus 5, ezride 6, shuttle 5, bikes 4 (plus `maxStations: 4`). Fallback walk estimate: `haversine × 1.3 / 1.3 m/s`.
- Poll intervals: MBTA predictions 20 s, MBTA schedules 10 min, MBTA alerts 2 min, Passio tripUpdates 20 s, Passio serviceAlerts 2 min, BlueBikes status 60 s.
- Staleness: older than 2 min → "data delayed" mark. Older than 10 min → drop live times and show schedule under "Live data unavailable, showing schedule" (or just "Live data unavailable" if there's no schedule).
- Board window: departures within the next 60 min, at most 3 times per row.
- Font size never shrinks below what reads at ~5 m. Overflow is handled by cutting content, never by scrolling.
- No browser storage. Full page reload daily at ~04:00 America/New_York (this also re-runs discovery).
- All schedule math uses the `America/New_York` service day, regardless of the kiosk's OS timezone.
- Passio agencies: `mit` (MIT shuttles), `charlesriver` (EZRide). Realtime JSON: `https://passio3.com/<agency>/passioTransit/gtfs/realtime/{tripUpdates,serviceAlerts}.json`. GTFS zips go via the Worker.
- BlueBikes: `https://gbfs.lyft.com/gbfs/2.3/bos/en/{station_information,station_status}.json`.
- Alerts shown: MBTA effects `DELAY, SUSPENSION, SHUTTLE, DETOUR, STOP_CLOSURE, STATION_CLOSURE, SERVICE_CHANGE, CANCELLATION, SNOW_ROUTE` on displayed routes/stops, plus all Passio alerts on displayed routes (or with no route, i.e. system-wide). Rotate every 10 s.

## Review Focus

1. **After-midnight service:** a SafeRide trip with `stop_times` `25:10:00` belongs to the *previous* service day. At 01:05 it must appear as "5 min", not be dropped or shown 24 h away. Test in Task 4.
2. **Kiosk in the wrong timezone:** if the OS clock is UTC, scheduled 18:00 trips must still be treated as 18:00 Eastern. Test in Task 4.
3. **Realtime trip not in the static zip** (Passio published new trips mid-semester): the departure still shows, with headsign falling back to the route long name, not dropped and not crashing. Test in Task 5.
4. **Valhalla returns `time: null`** for an unreachable target (e.g. a stop snapped to a highway): that stop is excluded, not treated as 0 min walk. Test in Task 8.
5. **Departures already in the past in a realtime feed** (feeds lag): never show negative minutes. Drop anything that left more than 0 s ago, except subway BRD/ARR states. Test in Task 9.

---

## File Structure

```text
vite.config.ts                     modify: base './', vitest config
package.json                       modify: vitest, fflate, scripts
src/
  main.ts                          (unchanged)
  App.svelte                       root: wires poller → board → layout
  app.css                          global theme tokens, vmin type scale
  config.ts                        Config type, default W41 config, URL overrides
  lib/
    types.ts                       shared domain types (below)
    geo.ts                         haversine, metres↔degrees, fallback walk time
    time.ts                        America/New_York service-day helpers
    worker-client.ts               URL builders + fetch helpers for the Worker
    gtfs/csv.ts                    tiny CSV parser
    gtfs/passio-static.ts          unzip + parse Passio GTFS → PassioStatic, scheduled departures
    gtfs/passio-realtime.ts        tripUpdates/serviceAlerts JSON → Departure[] / Alert[]
    mbta.ts                        MBTA discovery, predictions, schedules, alerts
    bluebikes.ts                   GBFS discovery + status
    discovery.ts                   candidates → walk matrix → filter → pin/hide
    board/countdown.ts             countdown label rules
    board/build.ts                 Departures + stops → BoardPanel[]
    board/trim.ts                  overflow cutting
    board/health.ts                staleness state per source
    poller.svelte.ts               runes store: per-source polling, health, daily reload
    components/Header.svelte
    components/Panel.svelte
    components/Row.svelte
    components/BikesPanel.svelte
    components/AlertStrip.svelte
  test/fixtures/                   recorded feed samples (JSON, small GTFS built in tests)
worker/
  package.json, tsconfig.json, wrangler.toml
  src/index.ts                     fetch handler: /mbta/*, /passio/:agency/gtfs.zip, /walk
  test/index.test.ts
.github/workflows/deploy.yml       build + deploy to GitHub Pages
README.md                          modify: config, Worker deploy, Athena deploy
```

The existing untracked stubs `src/lib/agencies/*` and `src/lib/feeds/*` are deleted in Task 1. Their URLs move into `config.ts` / `worker-client.ts`.

---

### Task 1: Tooling, shared types, config

**Files:**
- Modify: `package.json`, `vite.config.ts`
- Create: `src/lib/types.ts`, `src/config.ts`, `src/config.test.ts`
- Delete: `src/lib/agencies/`, `src/lib/feeds/`

**Interfaces:**
- Produces (`src/lib/types.ts`):

```ts
export type Mode = 'subway' | 'bus' | 'ezride' | 'shuttle' | 'bikes';
export type Source = 'mbta' | 'mit' | 'ezride' | 'bluebikes';
export type PanelId = 'subway' | 'bus' | 'shuttle' | 'bikes'; // bus panel holds mode bus + ezride
export interface LatLon { lat: number; lon: number }

export interface Stop {
  id: string;              // display id (MBTA parent station id for subway; stop id otherwise)
  source: Source; mode: Mode; name: string; lat: number; lon: number;
  platformIds: string[];   // ids used to query/join realtime (MBTA child stops; [id] for others)
  walkSec: number; walkEstimated: boolean; // true when fallback estimate was used
}
export interface RouteInfo {
  id: string; source: Source; mode: Mode;
  shortName: string; longName: string; color: string; textColor: string; // '#RRGGBB'
}
export interface Departure {
  source: Source; mode: Mode; routeId: string;
  stopId: string;          // platform-level id from the feed; mapped to Stop via platformIds
  directionKey: string;    // MBTA: `${routeId}:${direction_id}`; Passio: `${routeId}:${headsign}`
  headsign: string;
  departureTime: number;   // epoch ms
  arrivalTime?: number;    // epoch ms
  live: boolean;
  status?: string;         // MBTA prediction status text, shown verbatim
  vehicleStoppedHere?: boolean;
  tripId?: string;
}
export interface Alert { id: string; source: Source; header: string; routeIds: string[]; stopIds: string[] }
export interface BikeStation {
  id: string; name: string; lat: number; lon: number; walkSec: number;
  bikes?: number; ebikes?: number; docks?: number; renting?: boolean;
}
export type PanelStatus = 'ok' | 'delayed' | 'schedule-fallback' | 'unavailable';
export interface TimeCell { label: string; live: boolean; reachable: boolean; departureTime: number }
export interface BoardRow {
  key: string; route: RouteInfo; headsign: string;
  stopName?: string; walkMin?: number;  // set for non-subway rows (closest stop)
  times: TimeCell[];
}
export interface BoardGroup { header?: { name: string; walkMin: number }; rows: BoardRow[] }
export interface BoardPanel { id: PanelId; title: string; status: PanelStatus; groups: BoardGroup[] }
```

- Produces (`src/config.ts`):

```ts
export interface ModeLimit { maxWalkMin: number; maxStations?: number }
export interface Config {
  name: string; location: LatLon; workerUrl: string;
  modes: Record<Mode, ModeLimit>;
  pin: string[]; hide: string[];   // stop ids or route ids
  walkSpeedMps: number; walkDetourFactor: number;
}
export const defaultConfig: Config;
export function resolveConfig(search: string, base?: Config): Config; // applies ?lat=&lon=&name=
```

- [ ] **Step 1: Install tooling.** `npm i -D vitest` and `npm i fflate`. Add scripts `"test": "vitest run"`, `"test:watch": "vitest"`. In `vite.config.ts` set `base: './'` and `test: { environment: 'node', include: ['src/**/*.test.ts'] }` (use `/// <reference types="vitest/config" />`).
- [ ] **Step 2: Delete the stubs** `src/lib/agencies/` and `src/lib/feeds/`. Create `src/lib/types.ts` exactly as above.
- [ ] **Step 3: Write the failing test** `src/config.test.ts`:

```ts
it('defaults to W41', () => {
  const c = resolveConfig('');
  expect(c.name).toBe('W41');
  expect(c.location).toEqual({ lat: 42.35982, lon: -71.0961 });
  expect(c.modes.subway.maxWalkMin).toBe(15);
  expect(c.modes.bikes).toEqual({ maxWalkMin: 4, maxStations: 4 });
});
it('applies URL overrides', () => {
  const c = resolveConfig('?lat=42.36&lon=-71.09&name=Stata');
  expect(c.location).toEqual({ lat: 42.36, lon: -71.09 });
  expect(c.name).toBe('Stata');
});
it('ignores non-numeric lat/lon', () => {
  expect(resolveConfig('?lat=abc&lon=-71').location).toEqual(defaultConfig.location);
});
```

- [ ] **Step 4: Run** `npx vitest run src/config.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 5: Implement `src/config.ts`** with the Global Constraints values. `workerUrl` reads `import.meta.env.VITE_WORKER_URL`, falling back to `http://localhost:8787`. Lat/lon override applies only when both parse as finite numbers.
- [ ] **Step 6: Run** `npm test && npm run check`. Expected: PASS, 0 errors.
- [ ] **Step 7: Commit** `git add -A src package.json package-lock.json vite.config.ts && git commit -m "chore: vitest, shared types, config"`

---

### Task 2: Geo and time helpers

**Files:**
- Create: `src/lib/geo.ts`, `src/lib/geo.test.ts`, `src/lib/time.ts`, `src/lib/time.test.ts`

**Interfaces:**
- Produces:

```ts
// geo.ts
export function haversineM(a: LatLon, b: LatLon): number;
export function metresToDegrees(m: number): number;        // for MBTA filter[radius]: m / 111_320
export function candidateRadiusM(maxWalkMin: number, cfg: Config): number; // maxWalkMin*60*walkSpeedMps
export function fallbackWalkSec(from: LatLon, to: LatLon, cfg: Config): number; // haversine*detour/speed
// time.ts
export const TZ = 'America/New_York';
export function serviceDate(nowMs: number): string;          // 'YYYYMMDD' in TZ; before 03:00 counts as previous day
export function gtfsTimeToEpoch(serviceDate: string, hms: string): number; // 'HH:MM:SS' (HH may be ≥24) → epoch ms
export function weekdayOf(serviceDate: string): 'monday'|'tuesday'|'wednesday'|'thursday'|'friday'|'saturday'|'sunday';
export function msUntilNext(hourLocal: number, nowMs: number): number; // for 04:00 reload
```

- [ ] **Step 1: Write failing tests:**

```ts
// geo.test.ts
const W41 = { lat: 42.35982, lon: -71.0961 };
it('haversine W41→Central ≈ 870 m', () =>
  expect(haversineM(W41, { lat: 42.365304, lon: -71.103621 })).toBeCloseTo(870, -1));
it('candidate radius for 15 min = 1170 m', () =>
  expect(candidateRadiusM(15, defaultConfig)).toBe(1170));
it('fallback walk is ≥ straight line / speed', () =>
  expect(fallbackWalkSec(W41, { lat: 42.365304, lon: -71.103621 }, defaultConfig)).toBeCloseTo(870, -1));
// time.test.ts
it('serviceDate before 3am is previous day', () =>
  expect(serviceDate(Date.parse('2026-11-18T06:05:00Z'))).toBe('20261117')); // 01:05 EST
it('gtfsTimeToEpoch handles 25:10', () =>
  expect(new Date(gtfsTimeToEpoch('20261117', '25:10:00')).toISOString()).toBe('2026-11-18T06:10:00.000Z'));
it('gtfsTimeToEpoch is EDT-aware in summer', () =>
  expect(new Date(gtfsTimeToEpoch('20260715', '18:00:00')).toISOString()).toBe('2026-07-15T22:00:00.000Z'));
it('weekdayOf', () => expect(weekdayOf('20261117')).toBe('tuesday'));
```

- [ ] **Step 2: Run** `npx vitest run src/lib/geo.test.ts src/lib/time.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `gtfsTimeToEpoch` follows the GTFS definition: time is measured from "noon minus 12h" on the service date in TZ. Compute the TZ offset at noon of the service date via `Intl.DateTimeFormat(…, { timeZone: TZ, timeZoneName: 'longOffset' })`, then add `h*3600+m*60+s` seconds. The kiosk's OS timezone is never used.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: geo and service-day time helpers`

---

### Task 3: Cloudflare Worker

**Files:**
- Create: `worker/package.json` (deps: `wrangler`, `vitest`, `@cloudflare/workers-types`), `worker/tsconfig.json`, `worker/wrangler.toml`, `worker/src/index.ts`, `worker/test/index.test.ts`

**Interfaces:**
- Produces (HTTP):
  - `GET /mbta/{stops|predictions|schedules|alerts|routes}?…`: proxied to `https://api-v3.mbta.com/<path>?…` with `x-api-key: env.MBTA_API_KEY`. Forwards `If-Modified-Since`, returns `Last-Modified` and 304. Cache TTL: predictions 10 s, alerts 60 s, schedules 300 s, stops/routes 86400 s. Any other path → 404.
  - `GET /passio/{mit|charlesriver}/gtfs.zip`: proxied to `https://passio3.com/<agency>/passioTransit/gtfs/google_transit.zip`, cached 6 h. Other agencies → 404.
  - `POST /walk` body `{ origin: LatLon, targets: LatLon[] }` → `{ seconds: (number|null)[] }` in target order. Calls `https://valhalla1.openstreetmap.de/sources_to_targets` with `costing: 'pedestrian'`, chunked at 50 targets. Cached 24 h under a synthetic GET key `https://cache.local/walk/<sha256(JSON body with coords rounded to 5 dp)>`. Max 500 targets, else 400.
  - CORS: `Access-Control-Allow-Origin` echoes the request origin only if it's in `env.ALLOWED_ORIGINS` (comma-separated). Handles `OPTIONS`.
- Produces (TS): `export async function handle(req: Request, env: Env, deps: { fetch: typeof fetch; cache: Cache }): Promise<Response>`. The default export's `fetch` calls `handle` with `globalThis.fetch` and `caches.default`.
- `wrangler.toml` vars: `ALLOWED_ORIGINS = "http://localhost:5173,https://dtemkin1.github.io"`. Secret: `MBTA_API_KEY`.

- [ ] **Step 1: Write failing tests** (fake `fetch` records calls; fake `Cache` is a Map):

```ts
it('injects MBTA key and forwards query', async () => { /* GET /mbta/predictions?filter[stop]=70071 → upstream URL api-v3.mbta.com/predictions?filter[stop]=70071, header x-api-key='k' */ });
it('rejects non-allow-listed MBTA path', async () => { /* /mbta/vehicles → 404, fetch not called */ });
it('rejects unknown passio agency', async () => { /* /passio/avcog/gtfs.zip → 404 */ });
it('serves passio zip from cache on second call', async () => { /* fetch called once for two requests */ });
it('walk chunks 120 targets into 3 Valhalla calls and preserves order/nulls', async () => { /* fake Valhalla returns time=i or null; response.seconds length 120 */ });
it('CORS allows configured origin only', async () => { /* Origin https://dtemkin1.github.io → echoed; https://evil.example → no ACAO header */ });
it('OPTIONS preflight returns 204', async () => {});
```

- [ ] **Step 2: Run** `cd worker && npx vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement `handle`** to the interface above. Hash with `crypto.subtle.digest('SHA-256', …)`. Store cached responses with a `Cache-Control: max-age=<ttl>` header so the Cache API honours the TTL.
- [ ] **Step 4: Run** the tests. Expected: PASS. Also run `npx wrangler deploy --dry-run`. Expected: builds without error.
- [ ] **Step 5: Commit** `feat(worker): MBTA proxy, Passio zip cache, walk matrix`

---

### Task 4: Passio static GTFS

**Files:**
- Create: `src/lib/gtfs/csv.ts`, `src/lib/gtfs/passio-static.ts`, `src/lib/gtfs/passio-static.test.ts`, `src/lib/worker-client.ts`

**Interfaces:**
- Consumes: `serviceDate`, `gtfsTimeToEpoch`, `weekdayOf` (Task 2); types (Task 1).
- Produces:

```ts
// csv.ts
export function parseCsv(text: string): Record<string, string>[]; // handles quotes, CRLF, BOM
// worker-client.ts
export function workerUrl(cfg: Config, path: string): string;
export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<T>;
export async function fetchBytes(url: string, timeoutMs = 20_000): Promise<Uint8Array>;
// passio-static.ts
export interface PassioStatic {
  source: 'mit' | 'ezride';
  stops: Map<string, { id: string; name: string; lat: number; lon: number }>;
  routes: Map<string, RouteInfo>;
  trips: Map<string, { routeId: string; serviceId: string; headsign: string }>; // headsign resolved
  stopTimes: Map<string, { stopId: string; seq: number; dep: string /* HH:MM:SS, interpolated */ }[]>; // by trip
}
export function parsePassioZip(bytes: Uint8Array, source: 'mit' | 'ezride', mode: Mode): PassioStatic;
export function activeServiceIds(s: PassioStatic, serviceDate: string): Set<string>; // calendar + calendar_dates
export function scheduledDepartures(s: PassioStatic, stopIds: Set<string>, nowMs: number, windowMs: number): Departure[]; // live=false
```

Rules: `parsePassioZip` keeps `calendar` and `calendar_dates` rows internally. Route `shortName` = `route_short_name || route_long_name`. Colors come from `route_color`/`route_text_color`, defaulting to `#A31F34`/`#FFFFFF` for mit and `#1F77B4`/`#FFFFFF` for ezride. Trip headsign = `trip_headsign` || name of the trip's last stop || route long name. Blank `departure_time`/`arrival_time` between timepoints are linearly interpolated by `shape_dist_traveled` when present on both ends, else by `stop_sequence`. `scheduledDepartures` checks both today's and yesterday's service date (for ≥24:00 times). `directionKey` = `${routeId}:${headsign}`. The last stop of each trip is excluded (no boarding).

- [ ] **Step 1: Write failing tests.** Build a fixture zip in-test with `fflate.zipSync`: 1 route, 2 trips, stops A–D, trip 1 with A `07:30:00`, B blank, C blank, D `07:36:00` (shape_dist 0/100/200/300), empty `trip_headsign`, calendar weekday service, a `calendar_dates` exception removing service on 20261126, trip 2 at A `25:10:00`.

```ts
it('interpolates blank times', () => expect(trip1Times).toEqual(['07:30:00','07:32:00','07:34:00','07:36:00']));
it('headsign falls back to last stop name', () => expect(s.trips.get('t1')!.headsign).toBe('Stop D'));
it('calendar_dates removes service', () => expect(activeServiceIds(s, '20261126').size).toBe(0));
it('25:10 trip appears at 01:05 next morning', () => {
  const deps = scheduledDepartures(s, new Set(['A']), Date.parse('2026-11-18T06:05:00Z'), 3600e3);
  expect(deps.map(d => d.tripId)).toContain('t2');
});
it('uses Eastern time even if TZ=UTC', () => { /* process.env.TZ='UTC' set in test file header; 07:30 EST trip at A has departureTime = Date.parse('2026-11-17T12:30:00Z') */ });
it('excludes last stop of trip', () => { /* departures at D are [] */ });
it('parses quoted csv with commas', () => expect(parseCsv('a,b\r\n"x, y",z')).toEqual([{ a: 'x, y', b: 'z' }]));
```

- [ ] **Step 2: Run** `npx vitest run src/lib/gtfs`. Expected: FAIL.
- [ ] **Step 3: Implement** `csv.ts`, `worker-client.ts` (`AbortController` timeout, throw on non-2xx), and `passio-static.ts` (`fflate.unzipSync` + `strFromU8`). Skip `shapes.txt`.
- [ ] **Step 4: Run** the tests. Expected: PASS. Sanity check against the real MIT zip in a scratch script: route count is 13, no `NaN` departure times.
- [ ] **Step 5: Commit** `feat: Passio static GTFS parsing and scheduled departures`

---

### Task 5: Passio realtime

**Files:**
- Create: `src/lib/gtfs/passio-realtime.ts`, `src/lib/gtfs/passio-realtime.test.ts`, `src/test/fixtures/passio-mit-tripUpdates.json`, `src/test/fixtures/passio-mit-serviceAlerts.json`

**Interfaces:**
- Consumes: `PassioStatic` (Task 4).
- Produces:

```ts
export function passioRealtimeUrl(agency: 'mit' | 'charlesriver', feed: 'tripUpdates' | 'serviceAlerts'): string;
export function parseTripUpdates(json: unknown, s: PassioStatic, stopIds: Set<string>, nowMs: number): Departure[]; // live=true
export function parseServiceAlerts(json: unknown, source: 'mit' | 'ezride'): Alert[];
```

Rules: use `departure.time`, else `arrival.time` (epoch seconds → ms). Only `stop_id ∈ stopIds`. Skip `schedule_relationship` `SKIPPED`/`NO_DATA`. Headsign comes from static trip, else route long name, else `"Shuttle"`. Alert `header` = first `header_text.translation[].text`. `routeIds`/`stopIds` come from `informed_entity`.

- [ ] **Step 1: Record fixtures.** Save `curl -s https://passio3.com/mit/passioTransit/gtfs/realtime/tripUpdates.json` and `serviceAlerts.json` to `src/test/fixtures/`. Trim tripUpdates to ≤3 entities. Hand-add one entity with an unknown `trip_id` `"999999"` and a known `route_id`.
- [ ] **Step 2: Write failing tests:**

```ts
it('maps stop_time_update to Departure in ms', () => { /* first departure.departureTime === fixture time*1000, live true */ });
it('filters to discovered stops', () => { /* stopIds = {'988'} → all deps have stopId '988' */ });
it('unknown trip falls back to route long name', () => { /* headsign === route.longName for trip 999999 */ });
it('parses alert header', () => {});
```

- [ ] **Step 3: Run**, expect FAIL. **Step 4: Implement.** **Step 5: Run**, expect PASS.
- [ ] **Step 6: Commit** `feat: Passio realtime departures and alerts`

---

### Task 6: MBTA client

**Files:**
- Create: `src/lib/mbta.ts`, `src/lib/mbta.test.ts`, `src/test/fixtures/mbta-{stops-subway,stops-bus,predictions,schedules,alerts}.json`

**Interfaces:**
- Consumes: `workerUrl`, `fetchJson`, `metresToDegrees`, `candidateRadiusM`.
- Produces:

```ts
export interface MbtaCandidates { subway: Stop[]; bus: Stop[]; routes: Map<string, RouteInfo> } // walkSec=0 placeholder
export async function fetchMbtaCandidates(cfg: Config): Promise<MbtaCandidates>;
export function parseStops(json: unknown, mode: 'subway' | 'bus'): Stop[]; // subway: grouped by parent_station
export function predictionsUrl(cfg: Config, platformIds: string[]): string;
export function parsePredictions(json: unknown, nowMs: number): { departures: Departure[]; routes: RouteInfo[] };
export function schedulesUrl(cfg: Config, platformIds: string[], nowMs: number): string; // min_time/max_time HH:MM in TZ, next 60 min
export function parseSchedules(json: unknown): { departures: Departure[]; routes: RouteInfo[] }; // live=false
export function alertsUrl(cfg: Config, routeIds: string[], stopIds: string[]): string;
export function parseAlerts(json: unknown): Alert[]; // filtered to the effect allow-list
export const SHOWN_EFFECTS: readonly string[];
```

Request details:
- Stops: `stops?filter[latitude]&filter[longitude]&filter[radius]=<deg>&filter[route_type]=0,1&include=parent_station&fields[stop]=name,latitude,longitude` (and `route_type=3` for bus). Subway `Stop.id` = parent station id. `platformIds` = child ids. Lat/lon are the parent's.
- Predictions: `include=route,trip,vehicle`, `fields[prediction]=departure_time,arrival_time,direction_id,status,schedule_relationship,stop_sequence`, `fields[trip]=headsign`, `fields[route]=short_name,long_name,color,text_color,type`, `fields[vehicle]=current_status`, plus the vehicle's `stop` relationship.

Rules:
- Drop predictions with null `departure_time`, or with `schedule_relationship` in `CANCELLED`/`SKIPPED`.
- `vehicleStoppedHere` = vehicle `current_status === 'STOPPED_AT'` and the vehicle's stop id equals the prediction's stop id.
- `directionKey` = `${routeId}:${direction_id}`. Headsign from `trip.headsign`.
- Route mode: `type` 0/1 → `subway`, 3 → `bus`.
- `shortName` falls back to `long_name` (e.g. "Red Line"). Colors are `#`-prefixed API values.
- Silver Line routes (`SILVER_LINE_IDS = ['741','742','743','746','749','751']`) and route types 2/4 are excluded per spec.
- Platform ids are chunked at 100 per request if needed.

- [ ] **Step 1: Record fixtures** with `curl -sg` against `https://api-v3.mbta.com` (no key needed for recording) for W41 coordinates. Trim to a handful of records each, keeping at least one prediction with `status`, one `CANCELLED`, and one with null `departure_time`.
- [ ] **Step 2: Write failing tests:**

```ts
it('groups subway platforms under parent station', () => { /* Kendall/MIT place-knncl has platformIds incl '70071','70072' */ });
it('drops cancelled and null departure_time', () => {});
it('sets vehicleStoppedHere', () => {});
it('headsign from trip, directionKey route:dir', () => { /* 'Red:0', 'Alewife' */ });
it('radius in degrees', () => expect(new URL(fakeStopsUrl).searchParams.get('filter[radius]')).toBe((1170/111320).toFixed(5)));
it('alerts filtered by effect', () => { /* ELEVATOR_CLOSURE dropped, DELAY kept */ });
```

- [ ] **Step 3: Run**, FAIL. **Step 4: Implement.** **Step 5: Run**, PASS.
- [ ] **Step 6: Commit** `feat: MBTA discovery, predictions, schedules, alerts`

---

### Task 7: BlueBikes

**Files:**
- Create: `src/lib/bluebikes.ts`, `src/lib/bluebikes.test.ts`, `src/test/fixtures/gbfs-{station_information,station_status}.json` (trimmed to ~10 stations near W41)

**Interfaces:**
- Produces:

```ts
export const GBFS_BASE = 'https://gbfs.lyft.com/gbfs/2.3/bos/en/';
export function parseStationInfo(json: unknown, origin: LatLon, radiusM: number): BikeStation[]; // within radius, walkSec=0
export function applyStatus(stations: BikeStation[], json: unknown): BikeStation[]; // fills bikes/ebikes/docks/renting
```

Rules: `ebikes` = `vehicle_types_available` entry with the e-bike type id if present, else `num_ebikes_available`. A station with `is_renting === 0` is kept but shown as "Closed".

- [ ] **Steps:** write tests (`within radius only`, `applies counts`, `missing status → undefined counts`), run (FAIL), implement, run (PASS), commit `feat: BlueBikes discovery and status`.

---

### Task 8: Discovery orchestrator

**Files:**
- Create: `src/lib/discovery.ts`, `src/lib/discovery.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 6, 7.
- Produces:

```ts
export interface Discovered {
  stops: Stop[];                       // all modes except bikes, walk-filtered, pin/hide applied
  bikes: BikeStation[];                // nearest maxStations within walk limit
  routes: Map<string, RouteInfo>;      // key `${source}:${routeId}`
  passio: { mit?: PassioStatic; ezride?: PassioStatic };
}
export interface DiscoveryDeps {
  mbtaCandidates(cfg: Config): Promise<MbtaCandidates>;
  passioStatic(agency: 'mit' | 'charlesriver'): Promise<PassioStatic>;
  bikeInfo(): Promise<unknown>;
  walk(origin: LatLon, targets: LatLon[]): Promise<(number | null)[]>; // POST /walk
}
export async function discover(cfg: Config, deps: DiscoveryDeps): Promise<Discovered>;
export function defaultDiscoveryDeps(cfg: Config): DiscoveryDeps;
```

Algorithm:
1. Gather candidates per mode within `candidateRadiusM(limit)` by straight line. Passio stops come from `PassioStatic.stops`, keeping only stops served by at least one trip.
2. One `walk()` call for all candidates. A `null` result excludes that target (unless pinned).
3. If `walk()` throws, set every walkSec = `fallbackWalkSec` with `walkEstimated: true`.
4. Keep if `walkSec <= maxWalkMin*60` or the stop id is in `pin`. Drop any stop id in `hide`.
5. Bikes: sort by walkSec and take `maxStations`.
6. Each source's failure is isolated (a `Promise.allSettled` per source). A failed source simply has no stops.

- [ ] **Step 1: Write failing tests** with fake deps:

```ts
it('keeps Kendall (660 s) and drops Kenmore (1260 s) for subway 15 min', () => {});
it('null walk time excludes the stop', () => {});
it('pinned stop kept even if beyond limit', () => {});
it('hide removes stop', () => {});
it('walk failure → fallback estimates, walkEstimated true', () => {});
it('passio failure leaves MBTA stops intact', () => {});
it('bikes limited to nearest 4', () => {});
```

- [ ] **Step 2: Run**, FAIL. **Step 3: Implement.** **Step 4: Run**, PASS.
- [ ] **Step 5: Commit** `feat: walkshed discovery`

---

### Task 9: Board model (countdown, grouping, staleness, trimming)

**Files:**
- Create: `src/lib/board/countdown.ts`, `src/lib/board/health.ts`, `src/lib/board/build.ts`, `src/lib/board/trim.ts`, and a `*.test.ts` for each

**Interfaces:**
- Consumes: `Discovered`, `Departure`, `Alert`, types.
- Produces:

```ts
// countdown.ts
export function countdownLabel(d: Departure, nowMs: number): string | null; // null = don't show
// health.ts
export interface Health { lastOk: number | null } // per source
export function sourceStatus(h: Health, nowMs: number, hasSchedule: boolean): PanelStatus;
// build.ts
export interface BoardInput {
  discovered: Discovered; nowMs: number;
  live: Record<Source, Departure[]>; scheduled: Record<Source, Departure[]>;
  health: Record<Source, Health>; alerts: Alert[];
}
export function buildBoard(input: BoardInput): { panels: BoardPanel[]; alerts: Alert[] };
// trim.ts
export function trimPanel(p: BoardPanel, maxLines: number): BoardPanel; // a group header counts as 1 line, a row as 1
```

Countdown rules (`countdownLabel`):
- Use `status` verbatim if present.
- **Subway:** `BRD` if `vehicleStoppedHere` and departure is ≤ 90 s away. Else `ARR` if arrival is ≤ 30 s away. Else `1 min` if departure is < 60 s away (but ≥ 0). Else `${floor(sec/60)} min`.
- **Other modes:** `Now` if departure is < 60 s away, else `${floor(sec/60)} min`.
- Return `null` if departure is more than 0 s in the past (except the BRD/ARR cases) or more than 60 min away.

Staleness rules (`sourceStatus`):
- `lastOk === null` or age > 10 min → `schedule-fallback` if `hasSchedule`, else `unavailable`.
- Age > 2 min → `delayed`.
- Otherwise `ok`.

Build rules (`buildBoard`):
- Map each departure to its `Stop` via `platformIds`. Drop departures at unknown stops or routes in `hide`.
- **Live/scheduled merge:** per `(stop, directionKey)`, use live departures if the source status is `ok`/`delayed` and live has any for that key. Otherwise use the scheduled ones. A scheduled departure within 2 min of a live one for the same trip id is dropped.
- **Subway panel:** one group per station, sorted by walkSec. Header `{ name, walkMin: ceil(walkSec/60) }`. Rows keyed `routeId:headsign`. Title = the route `longName` if exactly one route, else `"Subway"`.
- **Bus panel** (modes `bus` + `ezride`) and **shuttle panel:** one row per `(source, directionKey)`, using the **closest stop** (min walkSec, ties by stop id) that has any departure for that key in the window. The row has `stopName` and `walkMin`. Rows are sorted by first reachable departure.
- `TimeCell.reachable` = `departureTime - nowMs >= walkSec*1000`. Keep ≤ 3 times per row, including at most 1 unreachable leading time.
- Rows/groups with no times are dropped. Panels with no rows are omitted, except bikes, which is omitted only when there are no stations.
- Panel status = the worst source status among the sources feeding it.
- **Alerts:** keep only those whose `routeIds ∩ shown route ids` or `stopIds ∩ shown stop/platform ids` is non-empty, plus Passio alerts with empty `routeIds`. De-duplicate by `id`.

Trim rules (`trimPanel`), applied until line count ≤ `maxLines`:
1. drop unreachable cells
2. reduce times per row to 2, then 1
3. drop rows whose first time is latest
4. drop groups that are left empty

- [ ] **Step 1: Write failing tests** (representative assertions):

```ts
// countdown
it('BRD when stopped and ≤90s', () => expect(countdownLabel(sub({ dep: 80, stopped: true }), 0)).toBe('BRD'));
it('ARR when arrival ≤30s', () => expect(countdownLabel(sub({ dep: 70, arr: 20 }), 0)).toBe('ARR'));
it('subway <60s is "1 min"', () => expect(countdownLabel(sub({ dep: 45 }), 0)).toBe('1 min'));
it('bus <60s is "Now"', () => expect(countdownLabel(bus({ dep: 45 }), 0)).toBe('Now'));
it('past departure is null', () => expect(countdownLabel(bus({ dep: -5 }), 0)).toBeNull());
it('status wins', () => expect(countdownLabel(sub({ dep: 300, status: 'Stopped 1 stop away' }), 0)).toBe('Stopped 1 stop away'));
// health
it('3 min old → delayed', () => {}); it('11 min, schedule → schedule-fallback', () => {}); it('11 min, none → unavailable', () => {});
// build
it('subway grouped by station, title "Red Line" when one route', () => {});
it('bus row uses closest stop serving the direction', () => {});
it('unreachable departure flagged', () => {});
it('stale live falls back to scheduled, status schedule-fallback', () => {});
it('elevator alert absent; Red Line DELAY alert shown when Red on board', () => {});
it('empty shuttle panel omitted', () => {});
// trim
it('trims in order: unreachable, times, rows', () => {});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/board`. Expected: FAIL.
- [ ] **Step 3: Implement** the four modules. **Step 4: Run**, PASS.
- [ ] **Step 5: Commit** `feat: board model`

---

### Task 10: Poller store

**Files:**
- Create: `src/lib/poller.svelte.ts`, `src/lib/poller.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:

```ts
export interface PollerDeps { now(): number; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; reload(): void; fetchJson: typeof fetchJson; discover(): Promise<Discovered> }
export function createPoller(cfg: Config, deps?: Partial<PollerDeps>): {
  readonly state: { discovered?: Discovered; live: Record<Source, Departure[]>; scheduled: Record<Source, Departure[]>;
                    health: Record<Source, Health>; alerts: Alert[]; bikes: BikeStation[]; now: number };
  start(): void; stop(): void;
};
```

Rules:
- `state` is `$state`. `now` ticks every 5 s.
- Each poll is an independent self-rescheduling timer at the Global Constraints interval. Errors are caught and logged, leave `health.lastOk` untouched, and the timer always reschedules.
- Passio scheduled departures are recomputed every 60 s from the in-memory `PassioStatic`. MBTA schedules come from the 10-min poll.
- If discovery fails, retry after 60 s.
- `reload()` is scheduled at `msUntilNext(4, now)`.

- [ ] **Step 1: Write failing tests** with `vi.useFakeTimers()` and fake fetch:

```ts
it('polls MBTA predictions every 20s', () => {});
it('fetch error keeps previous data and lastOk', () => {});
it('one source throwing does not stop others', () => {});
it('schedules reload at next 04:00 Eastern', () => {});
```

- [ ] **Step 2: Run**, FAIL. **Step 3: Implement.** **Step 4: Run**, PASS.
- [ ] **Step 5: Commit** `feat: per-source poller with daily reload`

---

### Task 11: UI (Layout A)

**Files:**
- Modify: `src/App.svelte`, `src/app.css`, `index.html` (favicon path to `./favicon.ico`)
- Create: `src/lib/components/{Header,Panel,Row,BikesPanel,AlertStrip}.svelte`

**Interfaces:**
- Consumes: `createPoller`, `buildBoard`, `trimPanel`, `resolveConfig`.
- `Panel.svelte` props: `{ panel: BoardPanel }`. It measures its body with a `ResizeObserver`, computes `maxLines = floor(bodyHeight / lineHeightPx)`, and renders `trimPanel(panel, maxLines)`.
- `BikesPanel.svelte` props: `{ stations: BikeStation[] }`.
- `AlertStrip.svelte` props: `{ alerts: Alert[] }`. It rotates every 10 s and is hidden when the list is empty.

Visual spec (from approved mockups):
- **Theme:** dark (`--bg #0e1116`, `--panel #171b22`, `--text #e8eaed`, `--muted #9aa0a6`, alert `#3a2a00`/`#ffd666`).
- **Type:** base size `clamp(16px, 2.2vmin, 48px)`. Times are bold and tabular-nums.
- **Landscape** (`@media (min-aspect-ratio: 1/1)`): CSS grid with columns `1.2fr 1fr 1fr .8fr` for subway, bus, shuttle, bikes. Missing panels collapse (`grid-auto-flow` with only present panels).
- **Portrait:** subway and bus full width, shuttle and bikes side by side.
- **Header:** `config.name` and a clock (`h:mm A`, America/New_York).
- **Fonts:** a system font stack. No external requests.
- **Unreachable times:** opacity .35.
- **Scheduled times:** muted color + italic.
- **Status marks:** `delayed` shows a small "data delayed" tag in the panel header. `schedule-fallback` shows the label "Live data unavailable, showing schedule". `unavailable` shows "Live data unavailable" in place of rows.
- **Route pills** use `route.color`/`textColor`.
- **Bus/shuttle rows** show `stopName · N min walk` in muted small text under the headsign.
- **Walk times** shown with `walkEstimated` get a "~" prefix.

- [ ] **Step 1: Implement** the components and `App.svelte`. `App` builds the board in a `$derived` from the poller state.
- [ ] **Step 2: Run** `npm run check && npm test`. Expected: 0 errors, all tests pass.
- [ ] **Step 3: Visual verification.** Run `cd worker && npx wrangler dev` (with `.dev.vars` containing `MBTA_API_KEY`) and `npm run dev`. Open `http://localhost:5173` at 1920×1080 and at 1080×1920 (browser device toolbar). Confirm:
  - the Red Line panel shows Kendall/MIT and Central with walk minutes
  - the 1 bus is in the bus panel
  - BlueBikes counts are shown
  - nothing scrolls
  - Kenmore is absent

  Also open `?lat=42.3601&lon=-71.0942` and confirm the board re-discovers.
- [ ] **Step 4: Commit** `feat: Layout A UI, landscape and portrait`

---

### Task 12: Deployment and docs

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `README.md`

- [ ] **Step 1: Write the deploy workflow.** On push to `main`: `npm ci`, `npm test`, `npm run build` with `VITE_WORKER_URL` from repo variable `vars.WORKER_URL`, then `actions/upload-pages-artifact` (`build/`) and `actions/deploy-pages`.
- [ ] **Step 2: Update `README.md`** with:
  - config fields and URL overrides (`?lat&lon&name`)
  - Worker deploy: `cd worker && npx wrangler secret put MBTA_API_KEY && npx wrangler deploy`, then add the deployed origin(s) to `ALLOWED_ORIGINS`
  - Athena deploy: `npm run build`, then copy `build/` to `~/www/transit-screen/` and add that origin to `ALLOWED_ORIGINS`
  - kiosk tips: fullscreen, disable sleep
- [ ] **Step 3: Verify.** Run `npm run build && npx vite preview --base /transit-screen/` and open `http://localhost:4173/transit-screen/`. Expected: the board renders and the network panel shows no 404s.
- [ ] **Step 4: Commit** `docs: deployment for Pages, Athena, and Worker`
