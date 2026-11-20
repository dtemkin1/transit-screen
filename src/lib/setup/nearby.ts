import type { Config } from '../../config';
import { defaultDiscoveryDeps, discover, type Discovered } from '../data/discovery';
import { walkLimits } from '../feeds';
import type { FeedConfig } from '../feeds/types';
import { PANELS } from '../board/panels';
import type { Mode, Source } from '../types';
import { candidateRadiusM, haversineM } from '../util/geo';

/** A stop or dock the setup page can hide or pin. */
export interface NearbyItem {
  id: string;
  source: Source;
  mode: Mode;
  name: string;
  walkMin: number;
  /** The feed's walk limit for this mode, in minutes. */
  limitMin: number;
  /** 'shown': within the walk limit, so on the board unless hidden. 'pinnable': past it, but close enough that `pin` brings it in. */
  state: 'shown' | 'pinnable';
}

/** How much farther than each walk limit to search, so stops just past it can be offered for pinning. */
const SEARCH_FACTOR = 3;

/** The feed with its walk limits (and dock count) raised by SEARCH_FACTOR. */
export function widen(feed: FeedConfig): FeedConfig {
  if (feed.kind === 'mbta') {
    return { ...feed, walkMin: { subway: feed.walkMin.subway * SEARCH_FACTOR, bus: feed.walkMin.bus * SEARCH_FACTOR } };
  }
  if (feed.kind === 'gbfs') return { ...feed, walkMin: feed.walkMin * SEARCH_FACTOR, maxStations: feed.maxStations * SEARCH_FACTOR };
  return { ...feed, walkMin: feed.walkMin * SEARCH_FACTOR };
}

const MODE_ORDER = PANELS.map((p) => p.id);

/**
 * Sorts a widened discovery into what the board would show and what `pin` could add. Pinning only
 * works inside a mode's straight-line candidate circle, so stops beyond it aren't offered. A dock
 * past its limit isn't either: the board keeps only the nearest few, so a pinned far one never shows.
 */
export function classify(d: Discovered, cfg: Config): NearbyItem[] {
  const out: NearbyItem[] = [];
  for (const x of [...d.stops, ...d.stations]) {
    const feed = cfg.feeds.find((f) => f.id === x.source);
    const limitMin = feed && walkLimits(feed)[x.mode];
    if (limitMin === undefined) continue;
    const within = x.walkSec <= limitMin * 60;
    const pinnable = 'platformIds' in x && haversineM(cfg.location, x) <= candidateRadiusM(limitMin, cfg);
    if (!within && !pinnable) continue;
    out.push({
      id: x.id, source: x.source, mode: x.mode, name: x.name, walkMin: Math.ceil(x.walkSec / 60), limitMin,
      state: within ? 'shown' : 'pinnable',
    });
  }
  return out.sort((a, b) => MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode) || a.walkMin - b.walkMin || a.name.localeCompare(b.name));
}

/** The names of the feeds discovery couldn't read, which it leaves out of `feeds`. */
export const failedFeeds = (d: Discovered, cfg: Config): string[] =>
  cfg.feeds.filter((f) => !(f.id in d.feeds)).map((f) => f.name);

/**
 * Stops and docks near `cfg.location`, found the way the board finds them but over a wider area,
 * and the feeds that couldn't be read (so a missing agency isn't mistaken for having no stops).
 */
export async function findNearby(cfg: Config): Promise<{ items: NearbyItem[]; failed: string[] }> {
  const wide: Config = { ...cfg, feeds: cfg.feeds.map(widen), pin: [], hide: [] };
  const d = await discover(wide, defaultDiscoveryDeps(wide));
  return { items: classify(d, cfg), failed: failedFeeds(d, cfg) };
}
