// Lets a screen start without network: after a power cut or a browser restart while the network is
// down, the board loads from this cache, says it can't reach the transit data, and recovers on its own.
import { self } from '$app/service-worker';
import { dev, version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';

const CACHE = `transit-screen-${version}`;
/** Long enough for a slow network; past it, a cached page beats a browser error. */
const PAGE_TIMEOUT_MS = 8_000;

/** The site's base path ("/transit-screen/" on GitHub Pages): this file is served from it. */
const BASE = new URL('./', self.location.href).pathname;
/** A manifest path (relative to the base) as the URL path the browser requests. */
const urlPath = (path: string) => BASE + path.replace(/^\//, '');
/** Hashed build files: a given URL never changes, so the cache can always answer for it. */
const HASHED = new Set(immutable.map(({ path }) => urlPath(path)));
/** The pages and static files of this version, which can change between versions. */
const OTHERS = new Set([...assets, ...prerendered].map(({ path }) => urlPath(path)));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll([...HASHED, ...OTHERS]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** The network first, so a screen always gets the current version; the cached copy only when that fails. */
async function networkFirst(request: Request, path: string): Promise<Response> {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
    // One copy per path: the board's settings are all in the query string.
    if (response.ok) await cache.put(path, response.clone());
    return response;
  } catch (e) {
    const cached = await cache.match(path);
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  // The dev server's modules change on every edit; caching them would only get in the way.
  if (dev) return;
  const { request } = event;
  const url = new URL(request.url);
  // The Worker, transit data and fonts are other origins: always live, never cached here.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (HASHED.has(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(request)));
  } else if (request.mode === 'navigate' || OTHERS.has(url.pathname)) {
    event.respondWith(networkFirst(request, url.pathname));
  }
});
