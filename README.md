# transit-screen

A full-screen departures board for W41 at MIT: the next hour of MBTA, MIT shuttle, EZRide, and BlueBikes options that are within walking distance. It is a static Svelte site plus a small Cloudflare Worker that proxies the transit APIs so the MBTA key never reaches the browser.

Agencies: MBTA, MIT Shuttles (Passio, `mit`), Charles River TMA / EZRide (Passio, `charlesriver`), BlueBikes.

## Layout

- `src/`: the Svelte 5 board (static output, no browser storage).
- `worker/`: the Cloudflare Worker (`worker/src/index.ts`) that fetches and caches upstream data.
- `.github/workflows/deploy.yml`: builds and deploys to GitHub Pages on every push to `main`.

Inside `src/`, data flows top to bottom through these folders. Each test file sits beside the file it tests.

| Path | What it holds |
| --- | --- |
| `main.ts`, `App.svelte`, `app.css` | Startup, page layout and the theme tokens (colors, fonts). |
| `config.ts` | Settings, URL parameters and the list of feeds (`FEEDS`). |
| `lib/types.ts` | Shared shapes: stops, routes, departures, stations, board panels. |
| `lib/feeds/` | One folder per kind of source (`mbta/`, `gtfs/`, `gbfs/`). Each has an `adapter.ts` (what to find nearby and what to poll) beside the code that parses that source's format. `types.ts` defines the adapter contract and the feed config; `index.ts` maps each kind to its adapter. |
| `lib/data/` | Getting data and keeping it current: `discovery.ts` finds nearby stops and walk times, `poller.svelte.ts` runs every feed's polls and holds the live state, `building.ts` looks up MIT buildings, `worker-client.ts` talks to the Worker, and `demo.svelte.ts` is the dev-only sample data. |
| `lib/board/` | Turning that state into what the screen shows: `panels.ts` (the panel table), `build.ts` (rows and notes), `countdown.ts`, `health.ts` (live, delayed or unavailable) and `trim.ts` (fitting rows to the space). |
| `lib/ui/` | The Svelte components, plus what only the screen needs: `format.ts` (badges, abbreviations, contrast), `palette.ts` (frame colors) and `rotation.svelte.ts` (cycling alerts). |
| `lib/util/` | Generic helpers: `geo.ts` (distances) and `time.ts` (Boston service-day time). |
| `test/fixtures/` | Recorded API responses used by the tests. |

Outside `src/`, `scripts/` holds the feed-name check (`npm run scan-names`), which the deploy workflow runs.

## Configuration

Settings live in `src/config.ts` (`defaultConfig`). The board can override some of them from the URL:

| Parameter | Example | Meaning |
| --- | --- | --- |
| `lat`, `lon` | `?lat=42.3598&lon=-71.0961` | Location to measure walking from. Both are needed; invalid values are ignored. |
| `building` | `?building=32` | MIT building number, shown large in the header. Its location and name come from the MIT campus map (see [Another building](#another-building)); it also switches to the `mit` palette (see [Another building](#another-building)). |
| `name` | `?name=Stata%20Center` | Building name shown beside the number. |
| `palette` | `?palette=apricot` | Frame color: an SA+P color (`apricot`, `yellow`, `pink`, `blue`, `orange`, `green`), `rotate` through them daily (default), or `mit` (black with MIT red accents). |
| `inset` | `?inset=3` | Margin, in % of the screen's shorter side (0-10), for TVs that crop the edges (overscan). Default 0. |
| `priority` | `?priority=shuttle,subway` | Which panels to keep on a screen too short for all of them, most important first (`subway`, `bus`, `shuttle`, `bikes`). Panels left out follow in the default order: Red Line, buses, shuttles, Bluebikes. |

Other `Config` fields are set in code only (`src/config.ts`):

- `location`, `building`, `name`: default to W41, Metropolitan Warehouse, `{ lat: 42.35982, lon: -71.0961 }`. URL overrides apply, see above.
- `workerUrl`: from the `VITE_WORKER_URL` build variable (default `http://localhost:8787`).
- `feeds`: the agencies on the board, each with its walk limit (MBTA subway 15 min and bus 7, MIT shuttles 5, EZRide 6, Bluebikes 8 with the nearest 4 docks). See [Adding a feed](#adding-a-feed).
- `pin`, `hide`: stop, route or alert IDs to pin or hide (routes and alerts also as `source:id`, e.g. `mbta:12345`). Hiding an alert is the way to remove one the wording filter misses. `pin` only keeps a stop that is already inside the mode's straight-line candidate circle (`maxWalkMin` x 60 x 1.3 m); it cannot add a farther stop.
- `walkSpeedMps` (1.3) and `walkDetourFactor` (1.3): used only for the straight-line walk estimate.

### What the board shows

- Each row shows the next departure you can still walk to in time, then up to two more. Trains or buses leaving sooner than the walk are left out, and the same vehicle reported twice within a minute (a repeated trip, a loop bus on back-to-back trips, or an MBTA "added" trip) is shown once.
- Times in italics come from the schedule (live data for that service is missing). The rest are live predictions.
- MBTA status messages ("Stopped 5 stops away") appear in the accent color (SA+P burgundy, or MIT Red) under the destination.
- Long names are shortened the way MBTA signs shorten them (Massachusetts → Mass, Avenue → Ave, Square → Sq, and → &; the list is in `src/lib/ui/format.ts`). A destination's "via …" part is set lighter, so when a row is cut it loses the route description, never the destination.
- Text that doesn't fit is cut between whole words, never inside one, with "…" and no dangling "&", "to" or "via" (`src/lib/ui/fit.ts`). A walk time ("2 min walk") is never split: the stop name shortens first. A shuttle row that can't fit its route name and destination shows the destination alone, since the badge names the route. Screen readers still get the full text.
- The building name is never cut: it shrinks to fit (`src/lib/ui/shrink.ts`), down to the size of body text, and below that wraps between words.
- Every panel shown has room for at least one row. On a screen too short for that (a phone held sideways, a small window), the lowest-priority panels are hidden (`priority` above), and the line at the bottom says which: "Bluebikes hidden: screen too short." More room brings them back.
- Alerts are screened for profanity, since people type them. A flagged alert isn't shown; see [Wording filter](#wording-filter).
- MIT shuttle rows lead with the route name ("Tech Shuttle to Kendall Square T"), since riders know shuttles by route. Routes Passio marks "out of service" are never shown.
- When one agency's data isn't fully live, the panel title says which ("EZRide: data delayed"), so live rows from the other agency in the same panel aren't called into question.
- All EZRide routes are labelled `EZ` in the agency color (the feed's `badge` in `src/config.ts`), with the trip's final stop as the destination.

### Look

The board follows the MIT School of Architecture and Planning identity as used on [sap.mit.edu](https://sap.mit.edu): departures in black on light gray, inside an L-shaped frame (header band and right edge) in one SA+P color. The rails between panels use the dark color SA+P pairs with it (burgundy, olive, or teal), since the light frame colors are too pale to separate panels on gray.

Like the site, where each page has its own color, the frame color changes every day at the 04:00 reload. Pin one with `palette` (`apricot` is the color of the site's Met Warehouse page).

The `mit` palette follows MIT's identity ([brand.mit.edu/color](https://brand.mit.edu/color)) instead: a black frame and rails, the building number in MIT Bright Red, and MIT Red for status text and the alert band.

Colors are in `src/lib/ui/palette.ts`; the rest of the styling is in `src/app.css`.

#### Checking the design

On the dev server (`npm run dev`), add one of these to the URL to see sample data:

- `?demo`: every state the board can show (an alert, MBTA status text, a delayed feed, a schedule fallback, long names, a shuttle badge color with no text color).
- `?demo=outage`: the "Live data unavailable" panels.
- `?demo=loading`: the startup screen.
- `?demo=failing`: the message shown when the transit data service can't be reached.

Combine with `palette` to check each color. The header says "Sample data" whenever demo mode is on, and demo mode is not included in production builds.

The mouse pointer hides after 3 seconds without movement, so it stays out of the way on the TV but is there when someone uses a mouse.

#### Fonts (optional, Adobe Fonts)

SA+P's own typefaces aren't available to license here, so the board uses the closest faces on Adobe Fonts when a kit is configured, and Helvetica/Arial and Georgia otherwise:

1. At [fonts.adobe.com](https://fonts.adobe.com), create a **web project** with these styles (the board uses no others):
   - **Neue Haas Grotesk Display**: 55 Roman and 65 Medium. Medium is the building number, panel titles and clock; Roman is the building name on MIT boards. (Adobe serves these at CSS weights 500 and 600, which `--display-medium` in `src/app.css` accounts for.)
   - **Neue Haas Unica** (SA+P departures): Regular, Italic, Bold, Bold Italic (not Heavy, which Adobe also serves at weight 700). Italics mark scheduled times; the next time is bold.
   - **Freight Text Pro** (SA+P building name, messages, legend): Book and Book Italic.
   - **Neue Haas Grotesk Text** (MIT departures, messages, legend): 55 Roman, 56 Italic, 75 Bold, 76 Bold Italic. MIT's brand ([brand.mit.edu](https://brand.mit.edu/typography)) sets everything in Neue Haas Grotesk, Display for large type and Text for small, with Arial as the fallback.
2. Add the domains the board is served from: `localhost`, `dtemkin1.github.io`, and `web.mit.edu`.
3. Put the project ID in `VITE_ADOBE_FONTS_KIT`: in `.env.local` for local builds, and as the repository variable `ADOBE_FONTS_KIT` for the GitHub Pages deploy.

The typefaces follow the palette: the SA+P colors use the SA+P set above, and `mit` uses MIT's (`:root[data-brand='mit']` in `src/app.css`).

The kit's CSS is fetched from `use.typekit.net` when the page loads. If it can't be reached, or a family is missing from the kit, the board falls back to Helvetica/Arial. The stacks are in `src/app.css`; if Adobe names a family differently in your kit, change the name there.

### Adding a feed

Every agency is one entry in `FEEDS` in `src/config.ts`. The board, the panel notes and the polling all read that list, so a new feed of a kind the board already supports needs no other app code:

- **`gtfs`**: any GTFS static zip, with optional GTFS-RT in JSON form (Passio serves this; protobuf-only feeds aren't supported yet).
  - Required: `mode` (the panel it belongs in, `bus` or `shuttle`), `walkMin`, and a fallback route `color`.
  - Optional: `realtime`, `badge` (one label for every route), `named` (rows lead with the route name), and `headsign: 'last-stop'` (when `trip_headsign` isn't a destination).
  - Without `realtime`, the feed shows its schedule in italics with no "live data unavailable" note.
  - The Worker proxies the zip, so also add its URL to `GTFS_STATIC` in `worker/src/sources.ts` under the same `id`, and deploy the Worker again.
- **`gbfs`**: any GBFS system with docks, from its `gbfs.json` autodiscovery URL. `unit` sets the words ("bike", "e-bike"). Also add the URL to `GBFS_DISCOVERY` in `worker/src/sources.ts`, so the name check covers it.
- **`mbta`**: the MBTA V3 API (one entry only).

Then run `npm run scan-names` and add anything under `flagged` to `LOCAL_NAMES` (see [Wording filter](#wording-filter)).

For example, a Passio shuttle with live data is:

```ts
{
  kind: 'gtfs', id: 'myshuttle', name: 'My Shuttle', mode: 'shuttle', walkMin: 5,
  realtime: passioRealtime('<passio agency>'), color: '#5F6368', named: true,
},
```

with `myshuttle: passio('<passio agency>')` in `GTFS_STATIC` (`worker/src/sources.ts`). If it shares the Shuttles panel with the MIT shuttles, the panel's title becomes "Shuttles" and each note names its agency.

A different kind of source (a car-share API, say) needs an adapter:

1. Add a folder in `src/lib/feeds/` (like `gbfs/`), with an `adapter.ts` beside the parsing code. The adapter implements `Adapter` from `src/lib/feeds/types.ts`: what it finds near the board, and what it polls.
2. Register it in `src/lib/feeds/index.ts`, and add its config type in `src/lib/feeds/types.ts`.
3. If it needs its own panel, add one in `src/lib/board/panels.ts` (title, height share, column, row layout) and in `Mode`.

Stations (`Station` in `src/lib/types.ts`) already carry their own `unit`, so a lot of cars renders the same way as a Bluebikes dock.

### Another building

For any MIT building, `?building=32` is enough. At startup the board looks the number up on MIT's campus map ([whereis.mit.edu](https://whereis.mit.edu)), through the Worker's `/building/{number}` route, which caches the answer for 30 days. That gives the walking origin and the building's name for the header ("Ray and Maria Stata Center"); buildings the map has no name for show only the number.

- `&name=` overrides the name.
- `&lat=...&lon=...` sets the location yourself, with no lookup, for a spot the map doesn't have.
- A number the map doesn't know shows a message saying so instead of departures.

Since SA+P's colors belong to SA+P, another `building` switches to the `mit` palette: MIT's black and red, and its typeface, Neue Haas Grotesk (see Fonts); add `&palette=` to choose otherwise, for example for an SA+P space in another building.

The default board (W41) keeps its location in `src/config.ts`, so it needs no lookup to start.

### Wording filter

Alerts and names are typed by people, so the board screens what it shows (`src/lib/util/decency.ts`, using the [obscenity](https://github.com/jo3-l/obscenity) word list, which also catches look-alike spellings such as "sh1t"):

- An alert whose text is flagged isn't shown.
- Official names (stops, routes, docks, buildings) are always shown, since a flag there is a false positive.
- A cut never ends where the shortened text would be flagged when the full name isn't ("N Harvard St @ Hooker…" becomes "N Harvard St…").
- Real street names the word list would flag (Cummins Hwy, Dickson St, …) are allowlisted in `LOCAL_NAMES`.

No filter is complete: `hide` removes a specific alert by ID.

Two reports show where the filter trips on real text:

- **Hidden alerts.** The board reports each one, once per page load, to the Worker's `/report` route, which logs it. See them in the Cloudflare dashboard under the Worker's **Logs** (on through `[observability]` in `worker/wrangler.toml`), or live with `npx wrangler tail` from `worker/`.
- **Feed names.** Every deploy checks every name in every feed and publishes the result beside the board as `names.json` (for example `https://dtemkin1.github.io/transit-screen/names.json`). The deploy run's summary says whether it's all clear, with a warning for each problem; the deploy goes ahead either way. Run it locally with `npm run scan-names`.
  - It runs in the deploy rather than the Worker because it takes about a second of CPU, past the Workers free plan's 10 ms limit.

`names.json` fields: `feeds` (names checked per feed), `flagged` (names the filter trips on), `allowlisted` (names that pass only because of `LOCAL_NAMES`) and `failed` (feeds it couldn't read). Empty `flagged` and `failed` mean all clear.

When something is flagged:

1. If it's a real street or place name, add its flagged part, in lower case, to `LOCAL_NAMES` in `src/lib/util/decency.ts`, and deploy.
2. If it's real profanity in an alert, nothing is needed: the board already hides it.
3. If a bad alert got through, add its ID to `hide`.

### Walking times

Walking times come from the public FOSSGIS Valhalla instance (`valhalla1.openstreetmap.de`). It is a shared, fair-use service, so the Worker caches results for 24 hours. If it is unavailable, the board falls back to a straight-line estimate. Estimated walk times show a `~` before the minutes.

### BlueBikes

Station data comes from the GBFS autodiscovery URL: `https://gbfs.bluebikes.com/gbfs/gbfs.json`.

## Local development

You need Node 22 and npm.

```sh
npm ci
cd worker && npm ci && cd ..

# Terminal 1: the Worker on http://localhost:8787
cd worker
npx wrangler dev        # optional: create worker/.dev.vars with MBTA_API_KEY=...

# Terminal 2: the board on http://localhost:5173
npm run dev
```

Without `MBTA_API_KEY`, the Worker calls MBTA without a key. That works at low volume, which is fine for development. The board's default `workerUrl` already points at `http://localhost:8787`. Set `VITE_WORKER_URL` in a root `.env.local` only if you run the Worker elsewhere.

Checks:

```sh
npm test       # board tests (TZ forced to UTC)
npm run check  # svelte-check and tsc
cd worker && npm test && npm run check
```

## Deploy the Worker (Cloudflare)

Run these from `worker/`:

```sh
npx wrangler secret put MBTA_API_KEY   # production: the MBTA key lives only here
npx wrangler deploy
```

The Worker serves `https://<your-worker>.<account>.workers.dev`. Its CORS allowlist is the `ALLOWED_ORIGINS` variable in `worker/wrangler.toml`. Add each origin that will host the board, then deploy again:

```toml
ALLOWED_ORIGINS = "http://localhost:5173,https://dtemkin1.github.io,https://<athena-origin>"
```

Browsers only let pages from listed origins read responses, because the Worker sends the CORS header only for them. This is not access control: non-browser clients can still call the Worker.

The board reloads itself daily at about 04:00 America/New_York, but only once the Worker is reachable.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` runs `npm ci`, `npm test`, and `npm run build`, then publishes `dist/`. One-time setup:

1. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Go to **Settings → Secrets and variables → Actions → Variables** and add `WORKER_URL` = `https://<your-worker>.<account>.workers.dev`. The build reads it as `VITE_WORKER_URL`. If `WORKER_URL` is not set, the deploy fails at the "Check WORKER_URL" step instead of publishing a board that cannot reach its Worker.
3. Make sure the Pages origin (`https://dtemkin1.github.io`) is in `ALLOWED_ORIGINS`.

Once Pages is enabled, the site will be at `https://dtemkin1.github.io/transit-screen/`. The Vite config uses a relative base, so the same build also works from a subpath.

## Deploy to Athena

Athena serves the static build from `~/www/transit-screen/`:

```sh
VITE_WORKER_URL=https://<your-worker>.<account>.workers.dev npm run build
mkdir -p ~/www/transit-screen && rm -rf ~/www/transit-screen/assets
cp -r dist/. ~/www/transit-screen/
```

Then add that origin (for example `https://<athena-origin>`) to `ALLOWED_ORIGINS` and redeploy the Worker.

## Kiosk setup

- Open the board in a browser's full-screen or kiosk mode (for example, Chrome with `--kiosk`, or press F11).
- Disable screen sleep and screensaver, both in the OS power settings and in the browser.
- The page needs no interaction: it starts on load and keeps itself up to date.
- To point a kiosk at another place, add `?building=...` to the URL (or `?lat=...&lon=...&building=...&name=...` for a place the campus map lacks).
