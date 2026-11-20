// Checks every feed name against the board's wording filter; a flagged name is a real street that
// belongs in LOCAL_NAMES (src/lib/util/decency.ts), or alerts naming it would be hidden. The build
// runs it and publishes the result as names.json (src/routes/names.json/+server.ts).
import { strFromU8, unzipSync } from 'fflate'
import { isAllowlisted, isIndecent } from '../util/decency.ts'
import { parseCsv } from '../feeds/gtfs/csv.ts'

export interface NameReport {
  checkedAt: string
  checked: number
  /** Names checked per feed that could be read. */
  feeds: Record<string, number>
  /** Add these to LOCAL_NAMES (or they're real problems). */
  flagged: { source: string; name: string }[]
  /** Passed only because of LOCAL_NAMES. */
  allowlisted: { source: string; name: string }[]
  /** Feeds that couldn't be read, so an empty `flagged` isn't mistaken for all-clear. */
  failed: string[]
}

export interface NameSources {
  mbtaKey?: string
  /** Feed id → static zip URL. */
  gtfs: Record<string, string>
  /** Feed id → gbfs.json autodiscovery URL. */
  gbfs: Record<string, string>
}

type Fetch = typeof fetch
const MBTA = 'https://api-v3.mbta.com'
const GTFS_FILES: Record<string, string[]> = {
  'stops.txt': ['stop_name'],
  'routes.txt': ['route_short_name', 'route_long_name'],
  'trips.txt': ['trip_headsign'],
}

async function json(fetchFn: Fetch, url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetchFn(url, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

async function mbtaNames(fetchFn: Fetch, key?: string): Promise<string[]> {
  const headers: Record<string, string> = key ? { 'x-api-key': key } : {}
  const [stops, routes] = await Promise.all([
    json(fetchFn, `${MBTA}/stops?fields[stop]=name`, headers),
    json(fetchFn, `${MBTA}/routes?fields[route]=long_name,short_name,direction_destinations`, headers),
  ])
  return [
    ...stops.data.map((s: any) => s.attributes.name),
    ...routes.data.flatMap((r: any) => [r.attributes.long_name, r.attributes.short_name, ...(r.attributes.direction_destinations ?? [])]),
  ]
}

async function gtfsNames(fetchFn: Fetch, url: string): Promise<string[]> {
  const res = await fetchFn(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const zip = unzipSync(new Uint8Array(await res.arrayBuffer()), { filter: (f) => f.name in GTFS_FILES })
  return Object.entries(GTFS_FILES).flatMap(([file, columns]) =>
    zip[file] ? parseCsv(strFromU8(zip[file])).flatMap((row) => columns.map((c) => row[c])) : [])
}

async function gbfsNames(fetchFn: Fetch, url: string): Promise<string[]> {
  const feeds: { name: string; url: string }[] = (await json(fetchFn, url)).data?.en?.feeds ?? []
  const info = feeds.find((f) => f.name === 'station_information')?.url
  if (!info) throw new Error(`no station_information feed in ${url}`)
  return ((await json(fetchFn, info)).data?.stations ?? []).map((s: any) => s.name)
}

export async function scanNames(fetchFn: Fetch, sources: NameSources, now = new Date()): Promise<NameReport> {
  const jobs: [string, Promise<string[]>][] = [
    ['mbta', mbtaNames(fetchFn, sources.mbtaKey)],
    ...Object.entries(sources.gtfs).map(([id, url]): [string, Promise<string[]>] => [id, gtfsNames(fetchFn, url)]),
    ...Object.entries(sources.gbfs).map(([id, url]): [string, Promise<string[]>] => [id, gbfsNames(fetchFn, url)]),
  ]
  const results = await Promise.allSettled(jobs.map(([, p]) => p))
  const seen = new Set<string>()
  const feeds: NameReport['feeds'] = {}
  const flagged: NameReport['flagged'] = []
  const allowlisted: NameReport['allowlisted'] = []
  const failed: string[] = []
  results.forEach((r, i) => {
    const source = jobs[i][0]
    if (r.status === 'rejected') {
      failed.push(source)
      return
    }
    feeds[source] = 0
    for (const raw of r.value) {
      const name = typeof raw === 'string' ? raw.trim() : ''
      if (!name || seen.has(`${source}:${name}`)) continue
      seen.add(`${source}:${name}`)
      feeds[source]++
      if (isIndecent(name)) flagged.push({ source, name })
      else if (isAllowlisted(name)) allowlisted.push({ source, name })
    }
  })
  return { checkedAt: now.toISOString(), checked: seen.size, feeds, flagged, allowlisted, failed }
}

/** Markdown for the Actions run page: all clear, or what to fix. */
export function summary(r: NameReport): string {
  const counts = Object.entries(r.feeds).map(([feed, n]) => `${feed} ${n}`).join(', ')
  const lines = [`### Feed names`, '', `Checked ${r.checked} names (${counts}).`, '']
  if (r.flagged.length === 0 && r.failed.length === 0) lines.push('All clear: no name trips the wording filter.')
  for (const { source, name } of r.flagged) lines.push(`- Flagged (${source}): **${name}**. Add it to \`LOCAL_NAMES\` in \`src/lib/util/decency.ts\`.`)
  for (const source of r.failed) lines.push(`- Could not read **${source}**, so its names weren't checked.`)
  lines.push('', `${r.allowlisted.length} names pass only because of \`LOCAL_NAMES\`.`)
  return lines.join('\n') + '\n'
}
