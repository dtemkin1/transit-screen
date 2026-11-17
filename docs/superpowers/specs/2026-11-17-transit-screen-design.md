# Transit Screen: Design

**Date:** 2026-11-17
**Status:** Draft, pending approval

Items marked *(decided)* were settled with the owner. Items marked *(builder-check call)* were decided by Claude after design review and are open to override.

## Intent

A wall-mounted departures board in the lobby of the MIT Metropolitan Storage Warehouse (W41, 134 Massachusetts Ave, Cambridge). It answers one question for someone about to leave the building: **"What's my best way out of here right now?"**

The main audience is students and SA+P staff. Visitors are secondary. People reading it are typically:

- heading to on-campus housing, by MIT shuttle or on foot
- taking the **1 bus** home from the Mass Ave stops outside
- walking to **Kendall/MIT** or **Central** for the **Red Line**
- taking the **EZRide** to North Station
- grabbing a **BlueBike**

## Goals

- Show live departures for MBTA (subway + bus), EZRide, and MIT shuttles, plus nearby BlueBikes availability, on one screen readable from across a lobby.
- **Location-driven, by walking time:** the board discovers what's within a per-mode *walking time* of a configured point (a walkshed computed on the real street network, not a circle), so it works at another building by changing the coordinates. A small pin/hide list handles exceptions.
- Account for walking. Show walk time for each stop, and fade out departures you can't reach in time.
- Run unattended for weeks. It recovers from network blips, feed outages, and new semester schedules without anyone touching it.
- Work on a TV in either landscape or portrait orientation. The resolution and orientation are not known in advance.

## Non-goals

- Trip planning or routing ("how do I get to X").
- Interactivity. Nobody will touch the screen, so it has no buttons, scrolling, or pagination that needs input.
- Phone use or a mobile layout. It may work on a phone, but that is not a target.
- Vehicle maps.

## Anti-goals (failures even if it "works")

- **Stale data shown as live.** If a feed stops updating, the board must say so rather than keep showing old times with confidence.
- **A frozen or blank screen** after a network outage, needing someone to reload it.
- **Clutter.** Every stop in a radius dumped onto the screen, or text too small to read from ~5 m.
- **Showing departures from routes that aren't running** (e.g. a daytime-only shuttle at 2 AM listed as "no predictions").

## Constraints

- **Hosting:** a static site deployable to GitHub Pages *or* MIT Athena (plain files, no server). It has no build step on the host, so whatever `vite build` emits must be self-contained. It must work under a sub-path (e.g. `/transit-screen/` on Pages, `~user/...` on Athena), so use relative asset paths (`base: './'`).
- **Backend:** at most one Cloudflare Worker on the owner's account, within the free plan's limits (100k requests/day, 10 ms CPU per request).
- **Existing project:** Svelte 5 + Vite + TypeScript, with `gtfs-types` and `gbfs-typescript-types` already installed. Stubs exist in `src/lib/agencies/` and `src/lib/feeds/` and can be reshaped freely.

## Data sources (verified 2026-11-17)

| Source | Static data | Realtime | Browser-fetchable (CORS)? |
|---|---|---|---|
| **MBTA** | V3 API `/stops?filter[latitude]&filter[longitude]&filter[radius]` (radius in degrees) | V3 API `/predictions`, `/alerts` (API key from owner's developer account) | Yes. Requests are routed through the Worker anyway, to keep the key out of the page |
| **MIT shuttles** (Passio, agency `mit`) | `https://passio3.com/mit/passioTransit/gtfs/google_transit.zip` (~65 KB) | `.../gtfs/realtime/tripUpdates.json`, `.../serviceAlerts.json` (GTFS-RT as JSON; times are absolute epoch) | Realtime: **yes** (`Access-Control-Allow-Origin: *`). Zip: **no** |
| **EZRide** (Passio, agency `charlesriver`, Passio ID 5019) | `https://passio3.com/charlesriver/passioTransit/gtfs/google_transit.zip` (~45 KB) | same paths under `/charlesriver/` | Realtime: **yes**. Zip: **no** |
| **BlueBikes** (GBFS 2.3) | `https://gbfs.lyft.com/gbfs/2.3/bos/en/station_information.json` | `.../station_status.json` | **Yes** |

The MIT GTFS documentation PDF from Passio contains copy-paste errors: some URLs say `avcog` where they should say `mit`. Use `mit` throughout.

| **Walking times** | Valhalla `sources_to_targets` matrix, `costing: "pedestrian"`, public FOSSGIS instance `https://valhalla1.openstreetmap.de` (OSM data, no key, fair-use policy) | n/a | **Yes**. Routed through the Worker anyway so results can be cached |

**Measured from W41 (42.35982, −71.09610):** straight-line, Central is 870 m, Kendall/MIT 910 m, Kenmore 1,210 m. By Valhalla walking time: Kendall/MIT **11 min** (920 m), Central **12 min** (1.03 km), Kenmore **21 min** (1.78 km, across the river). This is why discovery uses walking time: a circle that catches Central also catches Kenmore. Bus stops on Mass Ave and Vassar St are 100–300 m away.

## Approaches considered

**A. Thin Worker + smart browser (chosen).** The Worker caches the two Passio zips, relays MBTA V3 requests with the API key attached, and caches walking-time lookups. The browser does stop discovery, realtime polling, and rendering.
*Why:* the Worker stays about 30 lines with no state and is well within free-plan limits. It works on both hosts. Stop discovery is live, so changing the location needs no rebuild. It can grow into B later.

**B. Worker builds the whole board.** It returns one `/board?lat&lon` response, and the page just renders it.
*Rejected for now:* more code in the Cloudflare account, harder to debug, and the free plan's 10 ms CPU limit makes GTFS processing tight (it would need cron jobs plus KV). It only pays off with many screens.

**C. No Worker.** A nightly GitHub Action bakes the Passio data into the site, and the MBTA key ships in the page.
*Rejected:* Athena hosting would need manual rebuilds and copying. New semester schedules wouldn't appear until the next build. The key would be visible in the page.

## Architecture

```text
┌──────────────── Browser (static site) ────────────────┐
│  config.ts  → location, per-mode radii, pins/hides     │
│  discovery  → nearby stops per mode (on load + daily)  │
│  pollers    → realtime per source, own interval each   │
│  board      → merge, filter by walk time, group by mode│
│  UI         → Layout A, landscape/portrait             │
└──────┬─────────────────────┬──────────────────┬────────┘
       │ /mbta/*  /passio/*.zip                  │ direct
       ▼                     │                   ▼
  Cloudflare Worker          │        passio3.com/*/realtime/*.json
  (key injection, zip cache) │        gbfs.lyft.com (BlueBikes)
       ▼                     ▼
  api-v3.mbta.com     passio3.com/*/google_transit.zip
```

### Worker (`worker/`)

- `GET /mbta/<path>?<query>`: forwards to `https://api-v3.mbta.com/<path>`, adding the `x-api-key` header from a Worker secret. Only allow-listed paths (`stops`, `predictions`, `alerts`, `routes`, `schedules`) are forwarded. Short edge cache (~10 s for predictions, ~1 day for stops/routes) protects the rate limit if several screens run.
- `GET /passio/<agency>/gtfs.zip`: fetches `passio3.com/<agency>/passioTransit/gtfs/google_transit.zip`, edge-cached ~6 h. `<agency>` is allow-listed (`mit`, `charlesriver`).
- `POST /walk`: body `{ origin, targets[] }`. Forwards to Valhalla `sources_to_targets` (pedestrian) and returns walking seconds per target. Cached ~24 h, keyed by origin + sorted target set, so each screen hits Valhalla about once a day. Batches above Valhalla's matrix size limit are split.
- Adds `Access-Control-Allow-Origin` restricted to the deployed origins (GitHub Pages, Athena, `localhost` for dev).
- Deployed with Wrangler. The MBTA key is set via `wrangler secret put MBTA_API_KEY`.

### Configuration (`src/config.ts`, plus URL overrides)

```ts
{
  name: "W41",
  location: { lat: 42.35982, lon: -71.09610 },
  workerUrl: "https://<worker>.workers.dev",
  modes: {                         // limits are walking minutes on the street network
    subway:   { maxWalkMin: 15 },  // Kendall/MIT 11, Central 12; Kenmore (21) excluded
    bus:      { maxWalkMin: 5 },   // MBTA bus
    ezride:   { maxWalkMin: 6 },
    shuttle:  { maxWalkMin: 5 },   // MIT shuttles
    bikes:    { maxWalkMin: 4, maxStations: 4 },
  },
  pin:  [],          // stop IDs always shown even if outside the walkshed
  hide: [],          // stop IDs or route IDs never shown
  // fallback only, used when the walking-time service is unavailable:
  walkSpeedMps: 1.3,
  walkDetourFactor: 1.3,  // straight-line → street distance
}
```

URL query parameters (`?lat=…&lon=…&name=…`) override the location, so a second screen can reuse the same deployment.

### Discovery

Runs on load and again daily at ~4 AM local time (also picks up new semester schedules).

Discovery has two stages: a generous straight-line pre-filter to find candidates, then real walking times to decide what's in.

1. **Candidates.** For each mode, take everything within a circle of `maxWalkMin × walkSpeedMps × 60` metres. Walking distance is never shorter than the straight line, so this never drops anything that would pass stage 2.
   - **MBTA:** `/stops` with the lat/lon/radius filter (convert metres to degrees), once for `route_type=0,1` and once for `route_type=3`. Use parent stations for walk times (one target per station) but keep platform IDs for predictions.
   - **Passio (MIT, EZRide):** fetch each zip via the Worker, unzip in the browser (e.g. `fflate`), and parse `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, `calendar*.txt`. Keep the scheduled trips at candidate stops for "today".
   - **BlueBikes:** `station_information.json`.
2. **Walkshed.** Send all candidates from all modes in one `POST /walk` to the Worker. Keep a stop if its walking time is within its mode's `maxWalkMin`. For BlueBikes, keep the nearest `maxStations` that pass.
3. Apply `pin` / `hide`. Pinned stops still get a walking time.
4. Each stop's walk time is shown rounded up to the minute and used for the "can't make it" fade.
5. **Fallback:** if `/walk` fails, use `haversine × walkDetourFactor / walkSpeedMps` for every candidate and retry `/walk` at the next discovery. The board must never be blank because routing is down.

### Realtime polling

| Source | Interval | Notes |
|---|---|---|
| MBTA predictions | 20 s | One `/predictions?filter[stop]=…` call for all discovered stops, `include=route,trip,vehicle`, sparse `fields[...]` |
| MBTA schedules | 10 min | `/schedules?filter[stop]=…&filter[min_time]=…&filter[max_time]=…` for the next 60 min. Only used where a route/direction/stop has no prediction *(builder-check call)* |
| MBTA alerts | 2 min | `filter[route]`/`filter[stop]` for discovered routes/stops, `filter[activity]=BOARD,EXIT,RIDE`, active now |
| Passio tripUpdates (×2) | 20 s | Join `stop_time_update` → discovered stops; trip/route → static data for headsign and route name |
| Passio serviceAlerts (×2) | 2 min | |
| BlueBikes station_status | 60 s | `num_bikes_available`, `num_docks_available`, `is_renting` |

Each source fails independently: one feed being down never blanks the others.

### MBTA display rules

Follow MBTA's published guidance for third-party countdown displays (MBTA V3 API "best practices" docs). In short:

- Use `departure_time` for the countdown. Skip predictions with no `departure_time`: these are arrivals at the last stop or drop-off only, where you can't board.
- Drop predictions whose `schedule_relationship` is `CANCELLED` or `SKIPPED`.
- If a prediction has a `status` string, show it instead of minutes.
- Subway countdown labels: **BRD** when the vehicle is stopped at the station and departure is ≤ 90 s away; **ARR** when arrival is ≤ 30 s away; **1 min** for anything under 60 s; otherwise whole minutes, rounded down. Bus: minutes, with "Now" under 60 s.
- Headsign comes from the trip (`trip.headsign`), not the route's direction name.
- Use the route `color`/`text_color` from the API for line pills, rather than hard-coded colors (fall back to hard-coded if missing).
- Respect the rate limit: one batched request per poll, sparse fieldsets, honour `Last-Modified`/`If-Modified-Since` (the Worker forwards these headers).

### Board logic

- **Group by mode, not agency:** Subway / Buses (MBTA bus + EZRide) / MIT Shuttles / BlueBikes. The subway panel is titled with the line name when only one line is in range ("Red Line"), otherwise "Subway". Each line has its own color. Commuter rail, ferry, and Silver Line are out of scope *(builder-check call)*.
- **Rows when a route serves several nearby stops** *(decided)*:
  - **Subway:** grouped by station (a "Kendall/MIT · 11 min walk" header with route/direction rows under it), because choosing a station is a real decision.
  - **Bus, EZRide, shuttles:** one row per route + direction, using the **closest** discovered stop that serves it. That stop's name and walk time appear in small text on the row. The stop shown never flips between refreshes.
- Each row shows the next 2–3 departures.
- **Walk-time filtering:** a departure leaving sooner than the stop's walk time is shown faded. Departures more than ~60 min out are dropped.
- **Live vs scheduled:** times from realtime feeds are shown normally. Times from the static schedule only (no live vehicle) are shown in a lighter/italic style. A route with neither in the next 60 min is omitted entirely.
- **Empty panels collapse,** and the rest reflow to use the space.
- **Overflow** *(builder-check call)*: type never shrinks below the size that's readable from ~5 m. When a panel has more than fits, cut in this order:
  1. departures you can't reach in time (beyond the first per row)
  2. times per row (3, then 2, then 1)
  3. whole rows, dropping those whose next reachable departure is furthest away
- **Alerts** *(builder-check call)*: shown in a bottom strip only when they affect a displayed route or stop *and* change service: MBTA effects `DELAY`, `SUSPENSION`, `SHUTTLE`, `DETOUR`, `STOP_CLOSURE`, `STATION_CLOSURE`, `SERVICE_CHANGE`, `CANCELLATION`, `SNOW_ROUTE`, and all Passio alerts. Elevator/escalator/access notices and other informational effects are excluded. If there are several, they rotate every ~10 s.
- **Staleness** *(decided)*: a source whose last successful update is older than ~2 min shows a small "data delayed" mark on its panel. After ~10 min, live times are dropped. The panel then shows scheduled times in the lighter "scheduled" style, under a "Live data unavailable, showing schedule" label. If no schedule is available either, it shows just "Live data unavailable".

### UI (Layout A, approved via mockups)

- **Landscape:** header (location name, clock), four columns (Subway, Buses, MIT Shuttles, BlueBikes), alert strip at the bottom.
- **Portrait:** header, Subway full width, Buses full width, Shuttles and BlueBikes side by side, alert strip at the bottom.
- Orientation is chosen by CSS `@media (orientation: …)` / aspect ratio, so no configuration is needed.
- **Sizing:** all type and spacing in viewport units (`vmin`/`clamp`), so the page fills 1080p and 4K the same way. No scrolling ever.
- Dark theme (TV-friendly, less burn-in). MBTA colors come from the API. EZRide uses Passio's agency color (`#1f77b4`) or `routes.txt` `route_color`. MIT shuttles use `route_color`, falling back to MIT cardinal red.
- Header shows the board's name and current time. Each stop shows its walk time ("Kendall/MIT · 13 min walk").

### Reliability (kiosk)

- Every fetch has a timeout and is retried at the next interval. No unhandled promise rejections can stop the pollers.
- Full page reload once a day at ~4 AM, to pick up new deploys and clear any memory leaks.
- No reliance on browser storage. The page renders correctly from a cold load.

## Left to the builder

- Exact file/module layout under `src/lib/`. Reshape the existing stubs as needed.
- Choice of zip/CSV parsing libraries (small ones; `fflate` is suggested).
- Precise font sizes, spacing, and colors within the layout above.
- Worker cache TTLs within the ranges given.
- Testing approach: unit tests for discovery, walk-time math, the GTFS-RT → departure join, and staleness rules, using recorded feed fixtures.
