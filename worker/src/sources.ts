// Upstream feeds by the board's feed id (FEEDS in src/lib/config/feeds.ts). The Worker proxies only these
// GTFS zips; the site's build checks the names in all of them (src/lib/names/scan.ts).

const passio = (agency: string) => `https://passio3.com/${agency}/passioTransit/gtfs/google_transit.zip`

/** Static GTFS zips. */
export const GTFS_STATIC: Record<string, string> = {
  mit: passio('mit'),
  ezride: passio('charlesriver'),
  longwood: passio('longwoodcollective'),
}

/** GBFS autodiscovery URLs (the board fetches these itself; listed for the name scan). */
export const GBFS_DISCOVERY: Record<string, string> = {
  bluebikes: 'https://gbfs.bluebikes.com/gbfs/gbfs.json',
}
