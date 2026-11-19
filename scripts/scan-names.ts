// Prints the name check (names.ts) as JSON. The deploy workflow publishes it as names.json beside
// the board, and in GitHub Actions also flags each problem on the run; locally: `npm run scan-names`.
import { appendFileSync } from 'node:fs'
import { GBFS_DISCOVERY, GTFS_STATIC } from '../worker/src/sources.ts'
import { scanNames, summary } from './names.ts'

const report = await scanNames(fetch, { mbtaKey: process.env.MBTA_API_KEY, gtfs: GTFS_STATIC, gbfs: GBFS_DISCOVERY })
console.log(JSON.stringify(report, null, 2))

// In Actions, "::warning::" lines become warnings on the run; they never fail the deploy.
const actions = process.env.GITHUB_ACTIONS === 'true'
const warn = (message: string) => console.error(actions ? `::warning title=Feed names::${message}` : message)
for (const { source, name } of report.flagged) warn(`"${name}" (${source}) trips the wording filter; add it to LOCAL_NAMES`)
for (const source of report.failed) warn(`could not read ${source}; its names weren't checked`)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(report))
