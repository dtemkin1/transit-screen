# transit-screen

A full-screen departures board for W41 at MIT: the next hour of MBTA, MIT shuttle, EZRide, and BlueBikes options that are within walking distance. It is a static Svelte site plus a small Cloudflare Worker that proxies the transit APIs so the MBTA key never reaches the browser.

Agencies: MBTA, MIT Shuttles (Passio, `mit`), Charles River TMA / EZRide (Passio, `charlesriver`), BlueBikes.

## Layout

- `src/`: the Svelte 5 board (static output, no browser storage).
- `worker/`: the Cloudflare Worker (`worker/src/index.ts`) that fetches and caches upstream data.
- `.github/workflows/deploy.yml`: builds and deploys to GitHub Pages on every push to `main`.

## Configuration

Settings live in `src/config.ts` (`defaultConfig`). The board can override some of them from the URL:

| Parameter | Example | Meaning |
| --- | --- | --- |
| `lat`, `lon` | `?lat=42.3598&lon=-71.0961` | Location to measure walking from. Both are needed; invalid values are ignored. |
| `name` | `?name=32` | Building number, shown large in the header. Clears the default place name. |
| `place` | `?place=Stata%20Center` | Building name shown beside it. |
| `palette` | `?palette=apricot` | SA+P frame color: `apricot`, `yellow`, `pink`, `blue`, `orange`, `green`, or `rotate` (default). |
| `inset` | `?inset=3` | Margin, in % of the screen's shorter side (0-10), for TVs that crop the edges (overscan). Default 0. |

Other `Config` fields are set in code only (`src/config.ts`):

- `location`, `name`, `place`: default to W41, Metropolitan Warehouse, `{ lat: 42.35982, lon: -71.0961 }`. URL overrides apply, see above.
- `workerUrl`: from the `VITE_WORKER_URL` build variable (default `http://localhost:8787`).
- `modes`: maximum walk per mode (`subway` 15 min, `bus` 7, `ezride` 6, `shuttle` 5, `bikes` 8 min, plus `maxStations: 4` for bikes).
- `pin`, `hide`: stop or route IDs to pin or hide. `pin` only keeps a stop that is already inside the mode's straight-line candidate circle (`maxWalkMin` x 60 x 1.3 m); it cannot add a farther stop.
- `walkSpeedMps` (1.3) and `walkDetourFactor` (1.3): used only for the straight-line walk estimate.

### What the board shows

- Each row shows the next departure you can still walk to in time, then up to two more. Trains or buses leaving sooner than the walk are left out, and the same vehicle reported twice within a minute (a repeated trip, a loop bus on back-to-back trips, or an MBTA "added" trip) is shown once.
- Times in italics come from the schedule (live data for that service is missing). The rest are live predictions.
- MBTA status messages ("Stopped 5 stops away") appear in burgundy under the destination.
- MIT shuttle rows lead with the route name ("Tech Shuttle to Kendall Square T"), since riders know shuttles by route. Routes Passio marks "out of service" are never shown.
- When one agency's data isn't fully live, the panel title says which ("EZRide: data delayed"), so live rows from the other agency in the same panel aren't called into question.
- All EZRide routes are labelled `EZ` in the agency color (`EZRIDE_COLOR` in `src/lib/display.ts`), with the trip's final stop as the destination.

### Look

The board follows the MIT School of Architecture and Planning identity as used on [sap.mit.edu](https://sap.mit.edu): departures in black on light gray, inside an L-shaped frame (header band, right rail, and the rails between panels) in one SA+P color. Like the site, where each page has its own color, the frame color changes every day at the 04:00 reload. Pin one with `palette` (`apricot` is the color of the site's Met Warehouse page). Colors are in `src/lib/palette.ts`; the rest of the styling is in `src/app.css`.

#### Checking the design

On the dev server (`npm run dev`), add `?demo` to the URL to see sample data with every state the board can show: an alert, MBTA status text, a delayed feed, a schedule fallback, long names, and a shuttle badge color with no text color. `?demo=outage` shows the "Live data unavailable" panels and `?demo=loading` the startup screen. Combine with `palette` to check each color. Demo mode is not included in production builds.

#### Fonts (optional, Adobe Fonts)

SA+P's own typefaces aren't available to license here, so the board uses the closest faces on Adobe Fonts when a kit is configured, and Helvetica/Arial and Georgia otherwise:

1. At [fonts.adobe.com](https://fonts.adobe.com), create a **web project** with **Neue Haas Grotesk Display** (titles), **Neue Haas Unica** (departures), and **Freight Text Pro** (building name). Use the Regular and Medium weights of the Grotesk, Regular/Italic/Bold of Unica, and Regular of Freight Text.
2. Add the domains the board is served from: `localhost`, `dtemkin1.github.io`, and `web.mit.edu`.
3. Put the project ID in `VITE_ADOBE_FONTS_KIT`: in `.env.local` for local builds, and as the repository variable `ADOBE_FONTS_KIT` for the GitHub Pages deploy.

The kit's CSS is fetched from `use.typekit.net` when the page loads. If it can't be reached, the fallback fonts are used. The stacks are in `src/app.css`; if Adobe names a family differently in your kit, change the name there.

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
- To point a kiosk at another place, add `?lat=...&lon=...&name=...&place=...` to the URL.
