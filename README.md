# transit-screen

A full-screen departures board for W41 at MIT: the next hour of MBTA, MIT shuttle, EZRide, and BlueBikes options that are within walking distance. It is a static SvelteKit site plus a small Cloudflare Worker that proxies the transit APIs so the MBTA key never reaches the browser.

Agencies: MBTA, MIT Shuttles (Passio, `mit`), Charles River TMA / EZRide (Passio, `charlesriver`), BlueBikes.

## Layout

- `src/`: the board and its setup page, in SvelteKit with Svelte 5 (static output, no browser storage).
- `worker/`: the Cloudflare Worker (`worker/src/index.ts`) that fetches and caches upstream data.
- `.github/workflows/deploy.yml`: builds and deploys to GitHub Pages on every push to `main`.

Inside `src/`, data flows top to bottom through these folders. Each test file sits beside the file it tests.

| Path | What it holds |
| --- | --- |
| `routes/+page.ts`, `routes/+page.svelte`, `routes/board.css` | The board: its config from the URL, the page layout, and its colors and type sizes. |
| `routes/setup/` | The setup page (`setup/`), which builds a board's URL. |
| `routes/+layout.*`, `app.html`, `base.css` | What both pages share: the HTML shell, fonts, base styles (shared colors, type stacks), and the page options (prerendered, rendered in the browser). |
| `hooks.client.ts` | Sends errors the page didn't handle to the Worker's logs. |
| `service-worker/` | Caches the site so a screen can start without network. |
| `env.ts` | The build settings `WORKER_URL` and `ADOBE_FONTS_KIT`, checked when the site is built. |
| `lib/config/` | The board's settings: `options.ts` (what a board URL can say: one entry per parameter saying how to read it, and one way of writing them all), `resolve.ts` (`Config`, its defaults, what another building implies, and the shortest URL for a board) and `feeds.ts` (the list of agencies, `FEEDS`). |
| `lib/types.ts` | Shared shapes: stops, routes, departures, stations, board panels. |
| `lib/feeds/` | One folder per kind of source (`mbta/`, `gtfs/`, `gbfs/`). Each has an `adapter.ts` (what to find nearby and what to poll) beside the code that parses that source's format. `types.ts` defines the adapter contract and the feed config; `index.ts` maps each kind to its adapter. |
| `lib/data/` | Getting data and keeping it current: `discovery.ts` finds nearby stops and walk times, `poller.svelte.ts` runs every feed's polls and holds the live state, `building.ts` looks up MIT buildings, `worker-client.ts` talks to the Worker, and `demo.svelte.ts` is the dev-only sample data. |
| `lib/board/` | Turning that state into what the screen shows: `panels.ts` (the panel table), `build.ts` (rows and notes), `countdown.ts`, `health.ts` (live, delayed or unavailable) and `trim.ts` (fitting rows to the space). |
| `lib/ui/` | The Svelte components, plus what only the screen needs: `format.ts` (badges, abbreviations, contrast), `palette.ts` (frame colors) and `rotation.svelte.ts` (cycling alerts). |
| `lib/util/` | Generic helpers: `geo.ts` (distances) and `time.ts` (Boston service-day time). |
| `lib/setup/` | `nearby.ts`: the setup page's list of nearby stops to hide or pin. Its form edits `BoardOptions` directly. |
| `lib/names/`, `routes/names.json/` | The feed-name check (`scan.ts`), which the build runs and publishes as `names.json` (see [Wording filter](#wording-filter)). |
| `test/fixtures/` | Recorded API responses used by the tests. |

Pages import from `src/lib/` as `#lib/...`, with the file extension (`#lib/board/build.ts`). This is SvelteKit 3's replacement for `$lib`, defined in the `imports` field of `package.json`. SvelteKit's options live in `vite.config.ts`.

## Configuration

The easiest way to configure a screen is the setup page, `setup/` under the board (for example `https://dtemkin1.github.io/transit-screen/setup/`):

- It has a field for each URL parameter below. It looks the building up as you type and lists the stops and docks nearby: uncheck one to hide it, or check a farther one to pin it.
- A live preview shows the board at landscape TV, portrait TV and short-window sizes.
- **Copy URL** copies the board's URL, with only the settings that differ from the defaults.
- To change an existing screen, paste its URL under "Start from an existing board URL".

The page's own address keeps the form's settings, so a reload or a shared setup link opens with the same choices. Each change (or each pause while typing) is a step in the browser's history, so Back undoes it.

Settings live in `src/lib/config/resolve.ts` (`defaultConfig`). The board can override some of them from the URL. Each parameter is one entry in `PARAMS` in `src/lib/config/options.ts`:

| Parameter | Example | Meaning |
| --- | --- | --- |
| `lat`, `lon` | `?lat=42.3598&lon=-71.0961` | Location to measure walking from. Both are needed; invalid values are ignored. |
| `building` | `?building=32` | MIT building number, shown large in the header. Its location and name come from the MIT campus map (see [Another building](#another-building)); it also switches to the `mit` palette (see [Another building](#another-building)). |
| `name` | `?name=Stata%20Center` | Building name shown beside the number. |
| `palette` | `?palette=apricot` | Frame color: an SA+P color (`apricot`, `yellow`, `pink`, `blue`, `orange`, `green`), `rotate` through them daily (default), or `mit` (black with MIT red accents). |
| `inset` | `?inset=3` | Margin, in % of the screen's shorter side (0-10), for TVs that crop the edges (overscan). Default 0. |
| `priority` | `?priority=shuttle,subway` | Which panels matter most, most important first (`subway`, `bus`, `shuttle`, `bikes`). The highest in each column gets the column's spare room and gives up the least when the column is short. On a screen too short for every panel, the lowest are hidden first. Panels left out follow in the default order: Red Line, buses, shuttles, Bluebikes. |
| `pin`, `hide` | `?hide=2168,mbta:70` | Comma-separated ids to pin or hide; see `pin` and `hide` below. |

Other `Config` fields are set in code only (`src/lib/config/resolve.ts`):

- `location`, `building`, `name`: default to W41, Metropolitan Warehouse, `{ lat: 42.35982, lon: -71.0961 }`. URL overrides apply, see above.
- `workerUrl`: from the `WORKER_URL` build variable (default `http://localhost:8787`; see `src/env.ts`).
- `feeds`: the agencies on the board, each with its walk limit (MBTA subway 15 min and bus 7, MIT shuttles 5, EZRide 6, Bluebikes 8 with the nearest 4 docks). See [Adding a feed](#adding-a-feed).
- `pin`, `hide` (also URL parameters): stop, route or alert IDs to pin or hide (routes and alerts also as `source:id`, e.g. `mbta:12345`). Hiding an alert is the way to remove one the wording filter misses. `pin` only keeps a stop that is already inside the mode's straight-line candidate circle (`maxWalkMin` x 60 x 1.3 m); it cannot add a farther stop.
- `walkSpeedMps` (1.3) and `walkDetourFactor` (1.3): used only for the straight-line walk estimate.

### What the board shows

- Each row shows the next departure you can still reach, then up to two more. One leaving a little sooner than the walk (within a fifth of it, at least a minute) is close enough to run for: it shows first, marked `*` and set lighter. Those leaving sooner still are left out. If a row has nothing else, it shows the last of them alone, marked the same way, since you might still catch it by hurrying. In the shuttles panel that row sorts after the others. The same vehicle reported twice within a minute (a repeated trip, a loop bus on back-to-back trips, or an MBTA "added" trip) is shown once.
- Bus rows stay in route order (MBTA first, numbers as numbers: 1, 34E, 64, 85, CT2, then EZRide), each route's directions together, so a rider finds their bus in the same place. When the panel is short, the routes whose next bus is furthest away are left out, wherever they fall in that order. Shuttle rows are soonest first (`order` in `src/lib/board/panels.ts`).
- Times in italics come from the schedule (live data for that service is missing). The rest are live predictions.
- Times are worded as MBTA's [real-time display guidelines](https://www.mbta.com/developers/real-time-display-guidelines) ask, so the board agrees with the signs on the platform. Minutes are rounded to the nearest, half up. A subway train counts to its arrival, and shows ARR within 30 seconds and BRD while it's at the platform. A bus shows "Now" within 30 seconds. Route badges are bold full pills in MBTA's line colors, as on MBTA's own departure screens.
- A live time holds steady while its prediction moves later by under 30 seconds, so a countdown doesn't flip back up a minute as the prediction jitters, as MBTA's developer guidance suggests (`src/lib/data/steady.ts`). A prediction that moves earlier shows at once, so the board never shows a train later than predicted.
- The line at the bottom explains italics and `*` only while a row has such a time (a row a short panel cuts still counts), and keeps its height when empty so the panels don't move. It stays on one line: when it runs out of room, the hidden-panel note is cut first.
- During a planned disruption, MBTA's live data cancels timetabled trips, and the trains that do run appear in the feed only a few minutes ahead. Where that happens, the board doesn't fall back to the timetable for that stop and direction; with no live train listed, the row says "No trains predicted". A short panel keeps that row and cuts rows with times first. A trip listed with no times and no status counts as cancelled too, since MBTA says that means the train won't stop.
- MBTA status messages ("Stopped 5 stops away") appear in the accent color (SA+P burgundy, or MIT Red) under the destination.
- Long names are shortened the way MBTA signs shorten them (Massachusetts → Mass, Avenue → Ave, Square → Sq, and → &; the list is in `src/lib/ui/format.ts`). A destination's "via …" part is set lighter, so when a row is cut it loses the route description, never the destination.
- Text that doesn't fit is cut between whole words, never inside one, with "…" and no dangling "&", "to" or "via" (`src/lib/ui/fit.ts`). A walk time ("2 min walk") is never split: the stop name shortens first. A shuttle row that can't fit its route name and destination shows the destination alone, since the badge names the route. Screen readers still get the full text.
- The building name is never cut: it shrinks to fit (`src/lib/ui/shrink.ts`), down to the size of body text, and below that wraps between words.
- Each panel gets room for as many rows as its service could show today (`src/lib/board/size.ts`). Spare room goes to the column's highest-priority panel that has something to show; in a column too short for every panel's rows, lower-priority panels give up more. The count is for the whole service day, so borders stay put as departures come and go.
- Every panel shown has room for at least one row. On a screen too short for that (a phone held sideways, a small window), the lowest-priority panel in the column that ran short is hidden (`priority` above), and the line at the bottom says which: "Bluebikes hidden: screen too short." More room brings them back.
- Alerts take turns in the strip at the bottom, ten seconds each, up to two lines (three in portrait). The strip keeps the height of the longest alert in the rotation, so the panels above don't move as alerts change; it changes only when alerts are added or removed.
- Alerts are screened for profanity, since people type them. A flagged alert isn't shown; see [Wording filter](#wording-filter).
- MIT shuttle rows lead with the route name ("Tech Shuttle to Kendall Square T"), since riders know shuttles by route. Routes Passio marks "out of service" are never shown.
- When one agency's data isn't fully live, the panel title says which ("EZRide: data delayed"), so live rows from the other agency in the same panel aren't called into question.
- All EZRide routes are labelled `EZ` in the agency color (the feed's `badge` in `src/lib/config/feeds.ts`), with the trip's final stop as the destination. Since the routes look the same, routes to the same stop share one row.

### Look

The board follows the MIT School of Architecture and Planning identity as used on [sap.mit.edu](https://sap.mit.edu): departures in black on light gray, inside an L-shaped frame (header band and right edge) in one SA+P color. The rails between panels use the dark color SA+P pairs with it (burgundy, olive, or teal), since the light frame colors are too pale to separate panels on gray.

Like the site, where each page has its own color, the frame color changes every day at the 04:00 reload. Pin one with `palette` (`apricot` is the color of the site's Met Warehouse page).

The `mit` palette follows MIT's identity ([brand.mit.edu/color](https://brand.mit.edu/color)) instead: a black frame and rails, the building number in MIT Bright Red, and MIT Red for status text and the alert band.

Colors are in `src/lib/ui/palette.ts`; the rest of the styling is in `src/routes/board.css`, with what the setup page shares in `src/base.css`.

#### Checking the design

On the dev server (`npm run dev`), add one of these to the URL to see sample data:

- `?demo`: every state the board can show (an alert, MBTA status text, a delayed feed, a schedule fallback, long names, a shuttle badge color with no text color).
- `?demo=outage`: the "Live data unavailable" panels.
- `?demo=disruption`: a Red Line direction whose timetabled trips MBTA is cancelling, with no live train listed ("No trains predicted").
- `?demo=loading`: the startup screen.
- `?demo=failing`: the message shown when the transit data service can't be reached.

Combine with `palette` to check each color. The header says "Sample data" whenever demo mode is on, and demo mode is not included in production builds.

The mouse pointer hides after 3 seconds without movement, so it stays out of the way on the TV but is there when someone uses a mouse.

#### Fonts (optional, Adobe Fonts)

SA+P's own typefaces aren't available to license here, so the board uses the closest faces on Adobe Fonts when a kit is configured, and Helvetica/Arial and Georgia otherwise:

1. At [fonts.adobe.com](https://fonts.adobe.com), create a **web project** with these styles (the board uses no others):
   - **Neue Haas Grotesk Display**: 55 Roman and 65 Medium. Medium is the building number, panel titles and clock; Roman is the building name on MIT boards. (Adobe serves these at CSS weights 500 and 600, which `--display-medium` in `src/base.css` accounts for.)
   - **Neue Haas Unica** (SA+P departures): Regular, Italic, Bold, Bold Italic (not Heavy, which Adobe also serves at weight 700). Italics mark scheduled times; the next time is bold.
   - **Freight Text Pro** (SA+P building name, messages, legend): Book and Book Italic.
   - **Neue Haas Grotesk Text** (MIT departures, messages, legend): 55 Roman, 56 Italic, 75 Bold, 76 Bold Italic. MIT's brand ([brand.mit.edu](https://brand.mit.edu/typography)) sets everything in Neue Haas Grotesk, Display for large type and Text for small, with Arial as the fallback.
2. Add the domains the board is served from: `localhost`, `dtemkin1.github.io`, and `web.mit.edu`.
3. Put the project ID in `ADOBE_FONTS_KIT`: in `.env.local` for local builds, and as the repository variable of the same name for the GitHub Pages deploy. The build fails if it isn't a plain project ID.

The typefaces follow the palette: the SA+P colors use the SA+P set above, and `mit` uses MIT's (`:root[data-brand='mit']` in `src/routes/board.css`).

The kit's CSS is fetched from `use.typekit.net` when the page loads. If it can't be reached, or a family is missing from the kit, the board falls back to Helvetica/Arial. The stacks are in `src/base.css` (and the MIT ones in `src/routes/board.css`); if Adobe names a family differently in your kit, change the name there.

### Adding a feed

Every agency is one entry in `FEEDS` in `src/lib/config/feeds.ts`. The board, the panel notes and the polling all read that list, so a new feed of a kind the board already supports needs no other app code:

- **`gtfs`**: any GTFS static zip, with optional GTFS-RT in JSON form (Passio serves this; protobuf-only feeds aren't supported yet).
  - Required: `mode` (the panel it belongs in, `bus` or `shuttle`), `walkMin`, and a fallback route `color`.
  - Optional: `realtime`, `badge` (one label for every route), `named` (rows lead with the route name), and `headsign: 'last-stop'` (when `trip_headsign` isn't a destination).
  - Without `realtime`, the feed shows its schedule in italics with no "live data unavailable" note.
  - The Worker proxies the zip, so also add its URL to `GTFS_STATIC` in `worker/src/sources.ts` under the same `id`, and deploy the Worker again.
- **`gbfs`**: any GBFS system with docks, from its `gbfs.json` autodiscovery URL. `unit` sets the words ("bike", "e-bike"). Also add the URL to `GBFS_DISCOVERY` in `worker/src/sources.ts`, so the name check covers it.
- **`mbta`**: the MBTA V3 API (one entry only).

Then open `/names.json` on the dev server and add anything under `flagged` to `LOCAL_NAMES` (see [Wording filter](#wording-filter)).

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
3. If it needs its own panel, add one in `src/lib/board/panels.ts` (title, fallback height share, column, row layout) and in `Mode`.

Stations (`Station` in `src/lib/types.ts`) already carry their own `unit`, so a lot of cars renders the same way as a Bluebikes dock.

### Another building

For any MIT building, `?building=32` is enough. At startup the board looks the number up on MIT's campus map ([whereis.mit.edu](https://whereis.mit.edu)), through the Worker's `/building/{number}` route, which caches the answer for 30 days. That gives the walking origin and the building's name for the header ("Ray and Maria Stata Center"); buildings the map has no name for show only the number.

The lookup accepts building numbers as MIT's [Space Accounting Guidelines](https://web.mit.edu/facilities/maps/DesignStandards/T18%20-%20Space%20Accounting%20Guidelines%202022.pdf) form them (section 2.2), and the map's other place names:

- **Area prefixes:** none for the Main Group (`1`, `68`), or `N`, `NE`, `NW`, `E`, `EE`, `W` and `WW` (`NE49`, `WW15`).
- **Letters after the number:** a wing (`14N`), an auxiliary building (`6B`) or a component (`W61A`). Most have no entry of their own on the map, so the board measures walking from the main building (14, 6 or W61) and shows its name, with the lettered number in the header. Those the map does list, such as `6C` and `W85ABC`, are used directly.
- **Joined letters:** written with hyphens or without (`W85A-B-C` or `W85ABC`, `14N-S-E-W`). A room number (`32-123`) isn't a building and isn't looked up.
- **Place names:** `?building=pika`.

The map leaves out off-campus buildings (`OC` prefix) and some others, such as W57. For those, give `lat` and `lon` instead.

- `&name=` overrides the name.
- `&lat=...&lon=...` sets the location yourself, with no lookup, for a spot the map doesn't have.
- A number the map doesn't know shows a message saying so instead of departures.

Since SA+P's colors belong to SA+P, another `building` switches to the `mit` palette: MIT's black and red, and its typeface, Neue Haas Grotesk (see Fonts); add `&palette=` to choose otherwise, for example for an SA+P space in another building.

The default board (W41) keeps its location in `src/lib/config/resolve.ts`, so it needs no lookup to start.

### Wording filter

Alerts and names are typed by people, so the board screens what it shows (`src/lib/util/decency.ts`, using the [obscenity](https://github.com/jo3-l/obscenity) word list, which also catches look-alike spellings such as "sh1t"):

- An alert whose text is flagged isn't shown.
- Official names (stops, routes, docks, buildings) are always shown, since a flag there is a false positive.
- A cut never ends where the shortened text would be flagged when the full name isn't ("N Harvard St @ Hooker…" becomes "N Harvard St…").
- Real street names the word list would flag (Cummins Hwy, Dickson St, …) are allowlisted in `LOCAL_NAMES`.

No filter is complete: `hide` removes a specific alert by ID.

Two reports show where the filter trips on real text:

- **Hidden alerts.** The board reports each one, once per page load, to the Worker's `/report` route, which logs it. See them in the Cloudflare dashboard under the Worker's **Logs** (on through `[observability]` in `worker/wrangler.toml`), or live with `npx wrangler tail --config worker/wrangler.toml`. The same route logs errors a screen didn't handle (`client-error`; see [Keeping screens running](#keeping-screens-running)).
- **Feed names.** Every build checks every name in every feed and publishes the result beside the board as `names.json` (for example `https://dtemkin1.github.io/transit-screen/names.json`). In the deploy, the run's summary says whether it's all clear, with a warning for each problem; the deploy goes ahead either way. Locally, open `/names.json` on the dev server, which checks afresh on each request.
  - It runs at build time rather than in the Worker because it takes about a second of CPU, past the Workers free plan's 10 ms limit. Building therefore needs network; without it, every feed is listed under `failed`.

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
npm ci                  # the board and the Worker share one package.json

# Terminal 1: the Worker on http://localhost:8787
npm run worker:dev      # optional: create worker/.dev.vars with MBTA_API_KEY=...

# Terminal 2: the board on http://localhost:5173 (setup page at /setup/)
npm run dev
```

`npm run build` writes the static site to `build/`: `index.html` (the board), `setup/index.html`, `names.json` (the feed-name check) and `_app/` (scripts and styles).

Without `MBTA_API_KEY`, the Worker calls MBTA without a key. That works at low volume, which is fine for development. The board's default `workerUrl` already points at `http://localhost:8787`. Set `WORKER_URL` in a root `.env.local` only if you run the Worker elsewhere.

Checks:

```sh
npm test              # the board's and the Worker's tests (TZ forced to UTC)
npm run check         # svelte-check (the app and the Vite config), and tsc for the service worker
npm run worker:check  # tsc for the Worker and its tests
```

## Deploy the Worker (Cloudflare)

From the repository root:

```sh
npx wrangler secret put MBTA_API_KEY --config worker/wrangler.toml   # production: the MBTA key lives only here
npm run worker:deploy
```

The Worker serves `https://<your-worker>.<account>.workers.dev`. Its CORS allowlist is the `ALLOWED_ORIGINS` variable in `worker/wrangler.toml`. Add each origin that will host the board, then deploy again:

```toml
ALLOWED_ORIGINS = "http://localhost:5173,https://dtemkin1.github.io,https://<athena-origin>"
```

Browsers only let pages from listed origins read responses, because the Worker sends the CORS header only for them. This is not access control: non-browser clients can still call the Worker.

## Keeping screens running

- **Daily reload:** the board reloads itself at about 04:00 America/New_York, but only once the Worker is reachable.
- **New versions:** SvelteKit checks hourly for a new deploy, and the board reloads when it finds one, so a fix reaches every screen within the hour. The version is the commit (`GITHUB_SHA`), so the daily scheduled rebuild doesn't reload screens when nothing changed.
- **Starting without network:** a service worker (`src/service-worker/`) caches the site. If a screen powers on or its browser restarts while the network is down, the board still loads, says it can't reach the transit data, and recovers on its own. Pages come from the network whenever it answers (within 8 s), so a screen never stays on an old version. Worker and transit data are never cached.
- **Errors:** errors the page didn't handle are sent to the Worker's `/report` route and logged as `client-error`, each distinct error once and at most 10 per page load. On the dev server they stay in the console.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` runs `npm ci`, the checks (`npm run check`, `npm run worker:check`), `npm test` and `npm run build`, then publishes `build/`. It doesn't deploy the Worker; that's `npm run worker:deploy`. One-time setup:

1. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Go to **Settings → Secrets and variables → Actions → Variables** and add `WORKER_URL` = `https://<your-worker>.<account>.workers.dev`. The build checks it (`src/env.ts`) and fails on a malformed URL. If `WORKER_URL` is not set, the deploy fails at the "Check WORKER_URL" step instead of publishing a board that cannot reach its Worker.
3. Make sure the Pages origin (`https://dtemkin1.github.io`) is in `ALLOWED_ORIGINS`.

Once Pages is enabled, the site will be at `https://dtemkin1.github.io/transit-screen/`. SvelteKit writes relative paths and works out its base path in the browser, so the same build works from any subpath.

## Deploy to Athena

Athena serves the static build from `~/www/transit-screen/`:

```sh
WORKER_URL=https://<your-worker>.<account>.workers.dev npm run build
mkdir -p ~/www/transit-screen && rm -rf ~/www/transit-screen/_app
cp -r build/. ~/www/transit-screen/
```

Then add that origin (for example `https://<athena-origin>`) to `ALLOWED_ORIGINS` and redeploy the Worker.

## Kiosk setup

- Open the board in a browser's full-screen or kiosk mode (for example, Chrome with `--kiosk`, or press F11).
- Disable screen sleep and screensaver, both in the OS power settings and in the browser.
- The page needs no interaction: it starts on load and keeps itself up to date.
- To point a kiosk at another place, build its URL on the setup page (`setup/`), or add `?building=...` to the URL yourself (or `?lat=...&lon=...&building=...&name=...` for a place the campus map lacks).
