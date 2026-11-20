import { WORKER_URL } from '$app/env/public';
import type { PaletteChoice } from '../ui/palette';
import type { FeedConfig } from '../feeds/types';
import type { LatLon, PanelId } from '../types';
import { FEEDS } from './feeds';
import { NO_OPTIONS, OPTION_KEYS, PANEL_IDS, writeOptions, type BoardOptions } from './options';

export interface Config {
  /** Building number, shown large in the header ("W41"). */
  building: string;
  /** Building name beside it ("Metropolitan Warehouse"); may be empty. */
  name: string;
  /** Frame color, or 'rotate' for a new SA+P one each day. */
  palette: PaletteChoice;
  /** Margin for TV overscan, in % of the screen's shorter side (0-10). */
  inset: number;
  location: LatLon; workerUrl: string;
  /** Look `building` up on the MIT campus map for `location` (and `name`, when empty). */
  locate: boolean;
  /** Rows within a panel follow this order. */
  feeds: FeedConfig[];
  /** Stop ids to keep even past their walk limit (within the search radius). */
  pin: string[];
  /** Stop, route or alert ids to leave out; routes and alerts also as `${source}:${id}`. */
  hide: string[];
  walkSpeedMps: number; walkDetourFactor: number;
  /** Most important first: on a screen too short for every panel, the last ones are hidden. */
  priority: PanelId[];
}

export const defaultConfig: Config = {
  building: NO_OPTIONS.building,
  name: 'Metropolitan Warehouse',
  palette: 'rotate',
  inset: 0,
  location: { lat: 42.35982, lon: -71.0961 },
  workerUrl: WORKER_URL,
  locate: false,
  feeds: FEEDS,
  pin: [],
  hide: [],
  walkSpeedMps: 1.3,
  walkDetourFactor: 1.3,
  priority: [...PANEL_IDS],
};

/** The board for `options` (fields left out say nothing). Another building drops W41's name, location and SA+P colors. */
export function resolveConfig(options: Partial<BoardOptions>, base: Config = defaultConfig): Config {
  const o: BoardOptions = { ...NO_OPTIONS, ...options };
  const config: Config = { ...base, priority: o.priority, inset: o.inset, pin: o.pin, hide: o.hide };
  const building = o.building.trim();
  if (building && building !== base.building) {
    config.building = building;
    config.name = '';
    config.palette = 'mit';
    config.locate = true;
  }
  if (o.name) config.name = o.name;
  if (o.palette) config.palette = o.palette;
  const lat = o.lat.trim() === '' ? NaN : Number(o.lat);
  const lon = o.lon.trim() === '' ? NaN : Number(o.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    config.location = { lat, lon };
    config.locate = false;
  }
  return config;
}

/**
 * The shortest board query for `options`: a field is left out when the board comes out the same
 * without it (W41's own name, what another building implies). '' for the default board.
 */
export function boardSearch(options: BoardOptions): string {
  const board = JSON.stringify(resolveConfig(options));
  let kept = options;
  for (const key of OPTION_KEYS) {
    const without = { ...kept, [key]: NO_OPTIONS[key] };
    if (JSON.stringify(resolveConfig(without)) === board) kept = without;
  }
  return writeOptions(kept);
}
