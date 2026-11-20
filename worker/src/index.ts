import { GTFS_STATIC } from './sources'

export interface Env {
  /** Unset in local dev without a key; MBTA then serves keyless (lower rate limit). */
  MBTA_API_KEY?: string
  ALLOWED_ORIGINS: string
}

interface Deps {
  fetch: typeof fetch
  cache: Cache
}

interface LatLon {
  lat: number
  lon: number
}

const MBTA_TTL: Record<string, number> = {
  predictions: 10,
  alerts: 60,
  schedules: 300,
  stops: 86400,
  routes: 86400,
  route_patterns: 86400,
}
const GTFS_TTL = 6 * 3600
const WALK_TTL = 24 * 3600
const WALK_CHUNK = 50
const WALK_MAX = 500
const VALHALLA = 'https://valhalla1.openstreetmap.de/sources_to_targets'

function corsHeaders(req: Request, env: Env): Headers {
  const h = new Headers()
  const origin = req.headers.get('Origin')
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  if (origin && allowed.includes(origin)) {
    h.set('Access-Control-Allow-Origin', origin)
    h.set('Vary', 'Origin')
  }
  return h
}

function withCors(res: Response, cors: Headers): Response {
  const out = new Response(res.body, res)
  cors.forEach((v, k) => out.headers.set(k, v))
  return out
}

function text(status: number, body: string): Response {
  return new Response(body, { status })
}

function cacheable(res: Response, ttl: number): Response {
  const out = new Response(res.body, res)
  out.headers.set('Cache-Control', `public, max-age=${ttl}`)
  return out
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function cached(
  deps: Deps,
  key: Request,
  produce: () => Promise<Response>,
  ttl: number,
): Promise<Response> {
  const hit = await deps.cache.match(key)
  if (hit) return hit
  const res = await produce()
  if (res.status !== 200) return res
  const stored = cacheable(res, ttl)
  await deps.cache.put(key, stored.clone())
  return stored
}

async function mbta(req: Request, env: Env, deps: Deps, name: string, search: string): Promise<Response> {
  const ttl = MBTA_TTL[name]
  const key = new Request(`https://cache.local/mbta/${name}${search}`)
  const produce = async () => {
    const headers: Record<string, string> = {}
    if (env.MBTA_API_KEY) headers['x-api-key'] = env.MBTA_API_KEY
    const ims = req.headers.get('If-Modified-Since')
    if (ims) headers['If-Modified-Since'] = ims
    return deps.fetch(`https://api-v3.mbta.com/${name}${search}`, { headers })
  }
  // Conditional requests bypass the shared cache so 304 semantics reach the client.
  if (req.headers.has('If-Modified-Since')) {
    const up = await produce()
    return up.status === 200 ? cacheable(up, ttl) : up
  }
  return cached(deps, key, produce, ttl)
}

async function gtfs(deps: Deps, id: string): Promise<Response> {
  const key = new Request(`https://cache.local/gtfs/${id}`)
  return cached(deps, key, () => deps.fetch(GTFS_STATIC[id]), GTFS_TTL)
}

/** whereis.mit.edu (MIT's campus map) has every building but sends no CORS header. */
const WHEREIS ='https://whereis.mit.edu/search?type=query&output=json&q='
const BUILDING_ID = /^[A-Z0-9]{1,8}$/
const BUILDING_TTL = 30 * 86400

interface WhereisHit {
  /** Missing for places with no building number ("pika"). */
  bldgnum?: string
  /** "object-14", "object-pika". */
  id?: string
  name?: string
  lat_wgs84?: number
  long_wgs84?: number
}

// Building numbers follow MIT's Space Accounting Guidelines 2.2: an area prefix, a number, optional letters.

/** "W85A-B-C" → "W85ABC": a hyphen between single letters joins them. One before a digit starts a room ("32-123"). */
const joinLetters = (id: string) => id.replace(/-(?=[A-Z](?:-|$))/g, '')

/** The building a lettered number belongs to: "14N" → "14", "W57A" → "W57". It ends in a digit, so NW86 has none. */
const MAIN_BUILDING = /^(.*\d)[A-Z]+$/

/**
 * The building numbered `id`, else the place whose map id it is ("pika"). Exact matches only: a
 * search for "4" also finds "W4" and "E14".
 */
function findPlace(hits: WhereisHit[], id: string): WhereisHit | undefined {
  return hits.find((h) => h.bldgnum?.toUpperCase() === id) ?? hits.find((h) => h.id?.toUpperCase() === `OBJECT-${id}`)
}

const REPORT_MAX_BYTES = 4096

const isText = (v: unknown): v is string => typeof v === 'string'

/**
 * Logs what an unattended screen would otherwise keep to its own console: each alert the board hid
 * for its wording (so a real street the word list flags shows up), and errors the page didn't handle.
 */
async function report(req: Request): Promise<Response> {
  if (req.method !== 'POST') return text(405, 'method not allowed')
  const raw = await req.text()
  if (raw.length > REPORT_MAX_BYTES) return text(413, 'too large')
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return text(400, 'invalid json')
  }
  const b = (body ?? {}) as Record<string, unknown>
  const origin = req.headers.get('Origin')
  if (b.kind === 'hidden-alert' && isText(b.source) && isText(b.id) && isText(b.header)) {
    console.warn(JSON.stringify({ event: 'hidden-alert', source: b.source, id: b.id, header: b.header, origin }))
  } else if (b.kind === 'client-error' && isText(b.message) && isText(b.page) && (b.stack === undefined || isText(b.stack))) {
    console.error(JSON.stringify({ event: 'client-error', message: b.message, stack: b.stack, page: b.page, origin }))
  } else {
    return text(400, 'expected { kind: "hidden-alert", source, id, header } or { kind: "client-error", message, page, stack? }')
  }
  return new Response(null, { status: 204 })
}

async function building(deps: Deps, id: string): Promise<Response> {
  const key = new Request(`https://cache.local/building/${id}`)
  return cached(
    deps,
    key,
    async () => {
      const search = async (q: string): Promise<WhereisHit[] | Response> => {
        const up = await deps.fetch(WHEREIS + encodeURIComponent(q))
        if (!up.ok) return text(502, 'building upstream error')
        try {
          const hits: unknown = await up.json()
          return Array.isArray(hits) ? (hits as WhereisHit[]) : []
        } catch {
          return text(502, 'building upstream malformed')
        }
      }
      const hits = await search(id)
      if (hits instanceof Response) return hits
      // The campus map has no entry for most lettered parts (14N, W57A, 6B): they stand at their main
      // building. Its search for "14N" may already return 14; otherwise search for the main building.
      const main = MAIN_BUILDING.exec(id)?.[1]
      let hit = findPlace(hits, id) ?? (main ? findPlace(hits, main) : undefined)
      if (!hit && main) {
        const mainHits = await search(main)
        if (mainHits instanceof Response) return mainHits
        hit = findPlace(mainHits, main)
      }
      const lat = hit?.lat_wgs84
      const lon = hit?.long_wgs84
      if (!hit || typeof lat !== 'number' || typeof lon !== 'number') return text(404, 'no such building')
      // whereis names unnamed buildings "Building W41", or by the number ("E14") or id ("pika") alone.
      const own = [id, hit.bldgnum?.toUpperCase()].flatMap((n) => (n ? [n, `BUILDING ${n}`] : []))
      const name = hit.name && !own.includes(hit.name.toUpperCase()) ? hit.name : ''
      return Response.json({ number: id, name, lat, lon })
    },
    BUILDING_TTL,
  )
}

function isLatLon(v: unknown): v is LatLon {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as LatLon).lat === 'number' &&
    typeof (v as LatLon).lon === 'number' &&
    Number.isFinite((v as LatLon).lat) &&
    Number.isFinite((v as LatLon).lon)
  )
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5

async function walk(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return text(405, 'method not allowed')
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return text(400, 'invalid json')
  }
  const { origin, targets } = (body ?? {}) as { origin?: unknown; targets?: unknown }
  if (!isLatLon(origin) || !Array.isArray(targets) || !targets.every(isLatLon)) {
    return text(400, 'expected { origin, targets }')
  }
  if (targets.length > WALK_MAX) return text(400, `max ${WALK_MAX} targets`)

  const o = { lat: round5(origin.lat), lon: round5(origin.lon) }
  const t = targets.map((p) => ({ lat: round5(p.lat), lon: round5(p.lon) }))
  const hash = await sha256Hex(JSON.stringify({ origin: o, targets: t }))
  const key = new Request(`https://cache.local/walk/${hash}`)

  return cached(
    deps,
    key,
    async () => {
      const seconds: (number | null)[] = []
      for (let i = 0; i < t.length; i += WALK_CHUNK) {
        const chunk = t.slice(i, i + WALK_CHUNK)
        const up = await deps.fetch(VALHALLA, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sources: [o], targets: chunk, costing: 'pedestrian' }),
        })
        if (!up.ok) return text(502, 'walk upstream error')
        const json = (await up.json()) as { sources_to_targets?: { time: number | null }[][] }
        const row = json.sources_to_targets?.[0]
        if (!row || row.length !== chunk.length) return text(502, 'walk upstream malformed')
        for (const cell of row) seconds.push(typeof cell?.time === 'number' ? cell.time : null)
      }
      return Response.json({ seconds })
    },
    WALK_TTL,
  )
}

export async function handle(req: Request, env: Env, deps: Deps): Promise<Response> {
  const cors = corsHeaders(req, env)
  if (req.method === 'OPTIONS') {
    cors.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    cors.set('Access-Control-Allow-Headers', 'Content-Type, If-Modified-Since')
    cors.set('Access-Control-Max-Age', '86400')
    return new Response(null, { status: 204, headers: cors })
  }

  const url = new URL(req.url)
  const parts = url.pathname.split('/').filter(Boolean)
  let res: Response

  if (parts[0] === 'mbta' && parts.length === 2 && req.method === 'GET' && Object.hasOwn(MBTA_TTL, parts[1])) {
    res = await mbta(req, env, deps, parts[1], url.search)
  } else if (parts[0] === 'gtfs' && parts.length === 2 && req.method === 'GET' && Object.hasOwn(GTFS_STATIC, parts[1])) {
    res = await gtfs(deps, parts[1])
  } else if (parts[0] === 'building' && parts.length === 2 && req.method === 'GET' && BUILDING_ID.test(joinLetters(parts[1].toUpperCase()))) {
    res = await building(deps, joinLetters(parts[1].toUpperCase()))
  } else if (parts[0] === 'walk' && parts.length === 1) {
    res = await walk(req, deps)
  } else if (parts[0] === 'report' && parts.length === 1) {
    res = await report(req)
  } else {
    res = text(404, 'not found')
  }
  cors.set('Access-Control-Expose-Headers', 'Last-Modified')
  return withCors(res, cors)
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env, { fetch: globalThis.fetch.bind(globalThis), cache: caches.default })
  },
}
