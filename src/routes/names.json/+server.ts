// names.json: every feed name checked against the wording filter (src/lib/names/scan.ts). Written
// once per build, beside the board; on the dev server it's checked fresh on each request.
import { appendFileSync } from 'node:fs';
import { json } from '@sveltejs/kit';
import { building } from '$app/env';
import { scanNames, summary, type NameReport } from '#lib/names/scan.ts';
import { GBFS_DISCOVERY, GTFS_STATIC } from '../../../worker/src/sources.ts';
import type { RequestHandler } from './$types';

export const prerender = true;
// A file, not a page: served as names.json, not names.json/.
export const trailingSlash = 'never';

/** In GitHub Actions, flag each problem on the run and add the summary to its page. A report never fails the build. */
function reportToActions(report: NameReport) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  for (const { source, name } of report.flagged) {
    console.error(`::warning title=Feed names::"${name}" (${source}) trips the wording filter; add it to LOCAL_NAMES`);
  }
  for (const source of report.failed) console.error(`::warning title=Feed names::could not read ${source}; its names weren't checked`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(report));
}

export const GET: RequestHandler = async ({ fetch }) => {
  // MBTA answers without a key at this volume; one in the environment is used if present.
  const report = await scanNames(fetch, { mbtaKey: process.env.MBTA_API_KEY, gtfs: GTFS_STATIC, gbfs: GBFS_DISCOVERY });
  if (building) reportToActions(report);
  return json(report);
};
