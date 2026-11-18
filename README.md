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
| `name` | `?name=Lobby` | Label shown in the header. |

Other `Config` fields are set in code only:

- `location`, `name`: defaults to W41, `{ lat: 42.35982, lon: -71.0961 }`.
- `workerUrl`: from the `VITE_WORKER_URL` build variable (default `http://localhost:8787`).
- `modes`: maximum walk per mode (`subway` 15 min, `bus` 5, `ezride` 6, `shuttle` 5, `bikes` 4 min, plus `maxStations: 4` for bikes).
- `pin`, `hide`: stop or route IDs to pin or hide.
- `walkSpeedMps` (1.3) and `walkDetourFactor` (1.3): used only for the straight-line walk estimate.

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

Requests from origins not on this list are rejected.

The board reloads itself daily at about 04:00 America/New_York, but only once the Worker is reachable.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` runs `npm ci`, `npm test`, and `npm run build`, then publishes `dist/`. One-time setup:

1. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Go to **Settings → Secrets and variables → Actions → Variables** and add `WORKER_URL` = `https://<your-worker>.<account>.workers.dev`. The build reads it as `VITE_WORKER_URL`.
3. Make sure the Pages origin (`https://dtemkin1.github.io`) is in `ALLOWED_ORIGINS`.

The site is served at `https://dtemkin1.github.io/transit-screen/`. The Vite config uses a relative base, so the same build also works from a subpath.

## Deploy to Athena

Athena serves the static build from `~/www/transit-screen/`:

```sh
VITE_WORKER_URL=https://<your-worker>.<account>.workers.dev npm run build
cp -r dist/. ~/www/transit-screen/
```

Then add that origin (for example `https://<athena-origin>`) to `ALLOWED_ORIGINS` and redeploy the Worker.

## Kiosk setup

- Open the board in a browser's full-screen or kiosk mode (for example, Chrome with `--kiosk`, or press F11).
- Disable screen sleep and screensaver, both in the OS power settings and in the browser.
- The page needs no interaction: it starts on load and keeps itself up to date.
- To point a kiosk at another place, add `?lat=...&lon=...&name=...` to the URL.
