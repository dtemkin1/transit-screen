import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { scanNames, summary, type NameReport } from './scan.ts'

const zip = zipSync({
  'stops.txt': strToU8('stop_id,stop_name\n1,"Vassar St, Mass Ave"\n2,Sh1t Hollow Rd\n'),
  'routes.txt': strToU8('route_id,route_short_name,route_long_name\nr,,Tech Shuttle\n'),
  'trips.txt': strToU8('route_id,trip_id,trip_headsign\nr,t,Kendall\n'),
})

const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input)
  if (url.includes('/stops?')) return Response.json({ data: [{ attributes: { name: 'Cummins Hwy @ Harvard St' } }] })
  if (url.includes('/routes?')) return Response.json({ data: [{ attributes: { long_name: 'Red Line', short_name: '', direction_destinations: ['Alewife'] } }] })
  if (url === 'https://gtfs.test/mit.zip') return new Response(zip)
  if (url === 'https://gtfs.test/down.zip') return new Response('down', { status: 503 })
  if (url === 'https://gbfs.test/gbfs.json') return Response.json({ data: { en: { feeds: [{ name: 'station_information', url: 'https://gbfs.test/info' }] } } })
  if (url === 'https://gbfs.test/info') return Response.json({ data: { stations: [{ name: 'Mass Ave at Albany St' }] } })
  throw new Error(`unexpected ${url}`)
}) as typeof fetch

describe('scanNames', () => {
  it('reports each flagged name with its feed, passes allowlisted streets, and lists feeds it could not read', async () => {
    const report = await scanNames(fakeFetch, {
      gtfs: { mit: 'https://gtfs.test/mit.zip', ezride: 'https://gtfs.test/down.zip' },
      gbfs: { bluebikes: 'https://gbfs.test/gbfs.json' },
    }, new Date('2026-11-18T12:00:00Z'))
    expect(report).toEqual({
      checkedAt: '2026-11-18T12:00:00.000Z',
      checked: 8,
      feeds: { mbta: 3, mit: 4, bluebikes: 1 },
      flagged: [{ source: 'mit', name: 'Sh1t Hollow Rd' }],
      allowlisted: [{ source: 'mbta', name: 'Cummins Hwy @ Harvard St' }],
      failed: ['ezride'],
    })
  })
})

describe('summary', () => {
  const base: NameReport = { checkedAt: '', checked: 3, feeds: { mbta: 2, mit: 1 }, flagged: [], allowlisted: [], failed: [] }
  it('says all clear when nothing is flagged and every feed was read', () => {
    expect(summary(base)).toContain('Checked 3 names (mbta 2, mit 1).')
    expect(summary(base)).toContain('All clear')
  })
  it('lists what to fix otherwise, and is not all clear', () => {
    const s = summary({ ...base, flagged: [{ source: 'mit', name: 'Sh1t Hollow Rd' }], failed: ['ezride'] })
    expect(s).toContain('Flagged (mit): **Sh1t Hollow Rd**')
    expect(s).toContain('Could not read **ezride**')
    expect(s).not.toContain('All clear')
  })
})
