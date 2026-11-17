import { describe, expect, it } from 'vitest'
import { handle, type Env } from '../src/index'

class FakeCache {
  store = new Map<string, Response>()
  async match(req: Request | string) {
    const r = this.store.get(typeof req === 'string' ? req : req.url)
    return r ? r.clone() : undefined
  }
  async put(req: Request | string, res: Response) {
    this.store.set(typeof req === 'string' ? req : req.url, res.clone())
  }
}

type Call = { url: string; init?: RequestInit }

function setup(responder: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const reqInit = input instanceof Request ? { method: input.method, headers: input.headers, body: init?.body } : init
    calls.push({ url, init: reqInit })
    return responder(url, reqInit)
  }) as typeof fetch
  const cache = new FakeCache()
  const env: Env = {
    MBTA_API_KEY: 'k',
    ALLOWED_ORIGINS: 'http://localhost:5173,https://dtemkin1.github.io',
  }
  const run = (req: Request) =>
    handle(req, env, { fetch: fetchFn, cache: cache as unknown as Cache })
  return { calls, cache, run }
}

describe('worker', () => {
  it('injects MBTA key and forwards query', async () => {
    const { calls, run } = setup(() => new Response('{"data":[]}', { status: 200 }))
    const res = await run(new Request('https://w.test/mbta/predictions?filter[stop]=70071'))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api-v3.mbta.com/predictions?filter[stop]=70071')
    expect(new Headers(calls[0].init?.headers).get('x-api-key')).toBe('k')
  })

  it('rejects non-allow-listed MBTA path', async () => {
    const { calls, run } = setup(() => new Response('x'))
    const res = await run(new Request('https://w.test/mbta/vehicles'))
    expect(res.status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('passes MBTA upstream errors through without caching', async () => {
    const { cache, run } = setup(() => new Response('nope', { status: 429 }))
    const res = await run(new Request('https://w.test/mbta/alerts'))
    expect(res.status).toBe(429)
    expect(cache.store.size).toBe(0)
  })

  it('forwards If-Modified-Since and relays 304 with Last-Modified', async () => {
    const { calls, run } = setup(
      () => new Response(null, { status: 304, headers: { 'Last-Modified': 'Tue, 17 Nov 2026 10:00:00 GMT' } }),
    )
    const res = await run(
      new Request('https://w.test/mbta/schedules?x=1', {
        headers: { 'If-Modified-Since': 'Tue, 17 Nov 2026 09:00:00 GMT' },
      }),
    )
    expect(res.status).toBe(304)
    expect(res.headers.get('Last-Modified')).toBe('Tue, 17 Nov 2026 10:00:00 GMT')
    expect(new Headers(calls[0].init?.headers).get('If-Modified-Since')).toBe('Tue, 17 Nov 2026 09:00:00 GMT')
  })

  it('rejects unknown passio agency', async () => {
    const { calls, run } = setup(() => new Response('x'))
    const res = await run(new Request('https://w.test/passio/avcog/gtfs.zip'))
    expect(res.status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('serves passio zip from cache on second call', async () => {
    const { calls, run } = setup(() => new Response(new Uint8Array([80, 75]), { status: 200 }))
    const a = await run(new Request('https://w.test/passio/mit/gtfs.zip'))
    const b = await run(new Request('https://w.test/passio/mit/gtfs.zip'))
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://passio3.com/mit/passioTransit/gtfs/google_transit.zip')
  })

  it('walk chunks 120 targets into 3 Valhalla calls and preserves order/nulls', async () => {
    const { calls, cache, run } = setup((_url, init) => {
      const body = JSON.parse(String(init?.body))
      const row = body.targets.map((t: { lat: number }) =>
        t.lat < 0 ? { time: null } : { time: Math.round(t.lat) },
      )
      return new Response(JSON.stringify({ sources_to_targets: [row] }), { status: 200 })
    })
    const targets = Array.from({ length: 120 }, (_, i) => ({ lat: i === 7 ? -1 : i, lon: -71 }))
    const req = () =>
      new Request('https://w.test/walk', {
        method: 'POST',
        body: JSON.stringify({ origin: { lat: 42.35982, lon: -71.0961 }, targets }),
      })
    const res = await run(req())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { seconds: (number | null)[] }
    expect(json.seconds).toHaveLength(120)
    expect(json.seconds[7]).toBeNull()
    expect(json.seconds[119]).toBe(119)
    expect(json.seconds[50]).toBe(50)
    expect(calls).toHaveLength(3)
    expect(calls.every((c) => c.url === 'https://valhalla1.openstreetmap.de/sources_to_targets')).toBe(true)
    expect([...cache.store.keys()][0]).toMatch(/^https:\/\/cache\.local\/walk\/[0-9a-f]{64}$/)
    await run(req())
    expect(calls).toHaveLength(3)
  })

  it('walk rejects more than 500 targets and bad bodies', async () => {
    const { calls, run } = setup(() => new Response('x'))
    const targets = Array.from({ length: 501 }, () => ({ lat: 1, lon: 1 }))
    const big = await run(
      new Request('https://w.test/walk', { method: 'POST', body: JSON.stringify({ origin: { lat: 1, lon: 1 }, targets }) }),
    )
    expect(big.status).toBe(400)
    const bad = await run(new Request('https://w.test/walk', { method: 'POST', body: 'nope' }))
    expect(bad.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('CORS allows configured origin only', async () => {
    const { run } = setup(() => new Response('{}', { status: 200 }))
    const ok = await run(new Request('https://w.test/mbta/stops', { headers: { Origin: 'https://dtemkin1.github.io' } }))
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://dtemkin1.github.io')
    const bad = await run(new Request('https://w.test/mbta/stops', { headers: { Origin: 'https://evil.example' } }))
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('OPTIONS preflight returns 204', async () => {
    const { run } = setup(() => new Response('x'))
    const res = await run(
      new Request('https://w.test/walk', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })
})
