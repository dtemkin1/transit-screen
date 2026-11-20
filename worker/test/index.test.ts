import { describe, expect, it, vi } from 'vitest'
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

function setup(
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>,
  envOverrides: Partial<Env> = {},
) {
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
    ...envOverrides,
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

  it.each([[''], [undefined]])('omits the MBTA key header when the secret is %j', async (key) => {
    const { calls, run } = setup(() => new Response('{"data":[]}', { status: 200 }), {
      MBTA_API_KEY: key,
    })
    const res = await run(new Request('https://w.test/mbta/stops?filter[route_type]=0'))
    expect(res.status).toBe(200)
    expect(new Headers(calls[0].init?.headers).has('x-api-key')).toBe(false)
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

  it('looks up a building on whereis, taking only the exact match, and caches it', async () => {
    const hits = [
      { bldgnum: 'E14', name: 'E14', lat_wgs84: 42.3604, long_wgs84: -71.0873 },
      { bldgnum: '14', name: 'Hayden Library', lat_wgs84: 42.3591, long_wgs84: -71.0893 },
    ]
    const { calls, run } = setup(() => Response.json(hits))
    const a = await run(new Request('https://w.test/building/14'))
    expect(await a.json()).toEqual({ number: '14', name: 'Hayden Library', lat: 42.3591, lon: -71.0893 })
    expect(a.headers.get('Cache-Control')).toBe(`public, max-age=${30 * 86400}`)
    await run(new Request('https://w.test/building/14'))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://whereis.mit.edu/search?type=query&output=json&q=14')

    const e14 = await run(new Request('https://w.test/building/e14'))
    expect(await e14.json()).toMatchObject({ number: 'E14', name: '' })
  })

  it('finds a place with no building number by its whereis id ("pika")', async () => {
    const hits = [{ name: 'pika', id: 'object-pika', lat_wgs84: 42.3565, long_wgs84: -71.1082 }]
    const { calls, run } = setup(() => Response.json(hits))
    const res = await run(new Request('https://w.test/building/pika'))
    expect(await res.json()).toEqual({ number: 'PIKA', name: '', lat: 42.3565, lon: -71.1082 })
    expect(calls[0].url).toBe('https://whereis.mit.edu/search?type=query&output=json&q=PIKA')
  })

  it('places a wing ("14N") at its building, keeping the wing as the number', async () => {
    const hits = [{ bldgnum: '14', id: 'object-14', name: 'Hayden Memorial Library', lat_wgs84: 42.3592, long_wgs84: -71.0893 }]
    const { run } = setup(() => Response.json(hits))
    expect(await (await run(new Request('https://w.test/building/14n'))).json())
      .toEqual({ number: '14N', name: 'Hayden Memorial Library', lat: 42.3592, lon: -71.0893 })
  })

  it('places a lettered part the map lacks (W57A) at its main building, with a second search', async () => {
    const { calls, run } = setup((url) => Response.json(String(url).endsWith('q=W57')
      ? [{ bldgnum: 'W57', id: 'object-W57', name: 'Building W57', lat_wgs84: 1, long_wgs84: 2 }]
      : []))
    expect(await (await run(new Request('https://w.test/building/w57a'))).json())
      .toEqual({ number: 'W57A', name: '', lat: 1, lon: 2 })
    expect(calls.map((c) => c.url.split('q=')[1])).toEqual(['W57A', 'W57'])
  })

  it('reads letters joined by hyphens as the map writes them (W85A-B-C, 14N-S-E-W)', async () => {
    const hits = [
      { bldgnum: 'W85ABC', id: 'object-W85ABC', name: 'Westgate (ABC)', lat_wgs84: 1, long_wgs84: 2 },
      { bldgnum: '14', id: 'object-14', name: 'Hayden Memorial Library', lat_wgs84: 3, long_wgs84: 4 },
    ]
    const { run } = setup(() => Response.json(hits))
    expect(await (await run(new Request('https://w.test/building/W85A-B-C'))).json()).toMatchObject({ number: 'W85ABC', name: 'Westgate (ABC)' })
    expect(await (await run(new Request('https://w.test/building/14N-S-E-W'))).json()).toMatchObject({ number: '14NSEW', lat: 3 })
  })

  it('reads a building whose number ends in a letter as itself, not as a wing', async () => {
    const hits = [
      { bldgnum: 'NW86', name: 'Sidney Pacific', lat_wgs84: 1, long_wgs84: 2 },
      { bldgnum: 'NW8', name: 'Other', lat_wgs84: 3, long_wgs84: 4 },
    ]
    const { run } = setup(() => Response.json(hits))
    expect(await (await run(new Request('https://w.test/building/NW86'))).json()).toMatchObject({ name: 'Sidney Pacific' })
    // "W1N" is a wing of W1; without W1 in the results it's unknown, not some other building.
    expect((await run(new Request('https://w.test/building/W1N'))).status).toBe(404)
  })

  it('a building whereis does not know is a 404, and is not cached', async () => {
    const { calls, run } = setup(() => Response.json([{ bldgnum: 'W41', name: 'Building W41', lat_wgs84: 1, long_wgs84: 2 }]))
    expect((await run(new Request('https://w.test/building/W4'))).status).toBe(404)
    expect((await run(new Request('https://w.test/building/W4'))).status).toBe(404)
    expect(calls).toHaveLength(2)
    expect(await (await run(new Request('https://w.test/building/W41'))).json()).toMatchObject({ name: '' })
  })

  it.each(['/building/', '/building/W41/x', '/building/..%2Fx', '/building/TOOLONGNAME', '/building/32-123', '/building/32-G449'])(
    '404s without fetching for %s', async (path) => {
      const { calls, run } = setup(() => new Response('[]'))
      expect((await run(new Request(`https://w.test${path}`))).status).toBe(404)
      expect(calls).toHaveLength(0)
    },
  )

  it('report logs a hidden alert and answers 204, without fetching anything', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { calls, run } = setup(() => new Response('x'))
    const body = { kind: 'hidden-alert', source: 'mit', id: 'a7', header: 'Detour via Cummins Hwy' }
    const res = await run(new Request('https://w.test/report', {
      method: 'POST', headers: { Origin: 'https://dtemkin1.github.io' }, body: JSON.stringify(body),
    }))
    expect(res.status).toBe(204)
    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
      event: 'hidden-alert', source: 'mit', id: 'a7', header: 'Detour via Cummins Hwy', origin: 'https://dtemkin1.github.io',
    })
    expect(calls).toHaveLength(0)
    log.mockRestore()
  })

  it('report logs an error from a screen as an error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { run } = setup(() => new Response('x'))
    const body = { kind: 'client-error', message: 'TypeError: x is undefined', stack: 'at build', page: '/?building=32' }
    const res = await run(new Request('https://w.test/report', { method: 'POST', body: JSON.stringify(body) }))
    expect(res.status).toBe(204)
    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
      event: 'client-error', message: 'TypeError: x is undefined', stack: 'at build', page: '/?building=32', origin: null,
    })
    log.mockRestore()
  })

  it('report rejects anything else without logging', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { run } = setup(() => new Response('x'))
    const post = (body: string) => run(new Request('https://w.test/report', { method: 'POST', body }))
    expect((await run(new Request('https://w.test/report'))).status).toBe(405)
    expect((await post('not json')).status).toBe(400)
    expect((await post(JSON.stringify({ kind: 'other', source: 'mit', id: '1', header: 'x' }))).status).toBe(400)
    expect((await post(JSON.stringify({ kind: 'hidden-alert', source: 'mit', id: 1, header: 'x' }))).status).toBe(400)
    expect((await post(JSON.stringify({ kind: 'client-error', message: 'x' }))).status).toBe(400)
    expect((await post(JSON.stringify({ kind: 'hidden-alert', source: 'mit', id: '1', header: 'x'.repeat(5000) }))).status).toBe(413)
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('rejects a GTFS feed id not in the table', async () => {
    const { calls, run } = setup(() => new Response('x'))
    const res = await run(new Request('https://w.test/gtfs/avcog'))
    expect(res.status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('serves a GTFS zip from cache on second call', async () => {
    const { calls, run } = setup(() => new Response(new Uint8Array([80, 75]), { status: 200 }))
    const a = await run(new Request('https://w.test/gtfs/mit'))
    const b = await run(new Request('https://w.test/gtfs/mit'))
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

  it.each([
    '/mbta/constructor',
    '/mbta/toString',
    '/mbta/__proto__',
    '/mbta/hasOwnProperty',
    '/mbta/stops/../vehicles',
    '/mbta/stops%2F..%2Fvehicles',
    '/mbta/stops/extra',
    '/gtfs/mit/../x',
    '/gtfs/mit%2F..%2Fx',
    '/gtfs/mit/extra',
    '/gtfs/constructor',
    '/passio/mit/gtfs.zip',
  ])('404s without fetching for %s', async (path) => {
    const { calls, run } = setup(() => new Response('x'))
    const res = await run(new Request(`https://w.test${path}`))
    expect(res.status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('stores and returns Cache-Control max-age per TTL', async () => {
    const { cache, run } = setup(() => new Response('{}', { status: 200 }))
    const cases: [string, number][] = [
      ['/mbta/predictions', 10],
      ['/mbta/alerts', 60],
      ['/mbta/schedules', 300],
      ['/mbta/stops', 86400],
      ['/mbta/routes', 86400],
      ['/mbta/route_patterns', 86400],
      ['/gtfs/ezride', 21600],
    ]
    for (const [path, ttl] of cases) {
      const res = await run(new Request(`https://w.test${path}`))
      expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${ttl}`)
    }
    for (const stored of cache.store.values()) {
      expect(stored.headers.get('Cache-Control')).toMatch(/^public, max-age=\d+$/)
    }
    expect(cache.store.size).toBe(cases.length)
  })

  it('walk accepts exactly 500 targets and caches under 24h', async () => {
    const { calls, run } = setup((_u, init) => {
      const n = JSON.parse(String(init?.body)).targets.length
      return new Response(JSON.stringify({ sources_to_targets: [Array.from({ length: n }, () => ({ time: 1 }))] }))
    })
    const targets = Array.from({ length: 500 }, () => ({ lat: 1, lon: 1 }))
    const res = await run(
      new Request('https://w.test/walk', { method: 'POST', body: JSON.stringify({ origin: { lat: 1, lon: 1 }, targets }) }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400')
    expect(calls).toHaveLength(10)
  })

  it('walk cache key differs for different origins and targets', async () => {
    const { cache, run } = setup((_u, init) => {
      const n = JSON.parse(String(init?.body)).targets.length
      return new Response(JSON.stringify({ sources_to_targets: [Array.from({ length: n }, () => ({ time: 1 }))] }))
    })
    const post = (origin: object, targets: object[]) =>
      run(new Request('https://w.test/walk', { method: 'POST', body: JSON.stringify({ origin, targets }) }))
    await post({ lat: 1, lon: 1 }, [{ lat: 2, lon: 2 }])
    await post({ lat: 1.5, lon: 1 }, [{ lat: 2, lon: 2 }])
    await post({ lat: 1, lon: 1 }, [{ lat: 2, lon: 3 }])
    await post({ lat: 1.000001, lon: 1 }, [{ lat: 2, lon: 2 }])
    expect(cache.store.size).toBe(3)
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
