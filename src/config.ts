import { isPaletteName, type PaletteChoice } from './lib/palette';
import type { LatLon, Mode } from './lib/types';

export interface ModeLimit { maxWalkMin: number; maxStations?: number }
export interface Config {
  name: string;   // building number, shown in the header block ("W41")
  place: string;  // building name beside it ("Metropolitan Warehouse"); may be empty
  palette: PaletteChoice; // SA+P frame color, or 'rotate' for a new one each day
  inset: number;  // margin for TV overscan, % of the screen's shorter side (0-10)
  location: LatLon; workerUrl: string;
  modes: Record<Mode, ModeLimit>;
  pin: string[]; hide: string[];   // stop ids or route ids
  walkSpeedMps: number; walkDetourFactor: number;
}

/** An unset or empty VITE_WORKER_URL (e.g. an unset CI variable) falls back to local dev. */
export function pickWorkerUrl(raw: string | undefined): string {
  return raw || 'http://localhost:8787';
}

export const defaultConfig: Config = {
  name: 'W41',
  place: 'Metropolitan Warehouse',
  palette: 'rotate',
  inset: 0,
  location: { lat: 42.35982, lon: -71.0961 },
  workerUrl: pickWorkerUrl(import.meta.env.VITE_WORKER_URL),
  modes: {
    subway: { maxWalkMin: 15 },
    bus: { maxWalkMin: 7 },
    ezride: { maxWalkMin: 6 },
    shuttle: { maxWalkMin: 5 },
    bikes: { maxWalkMin: 8, maxStations: 4 },
  },
  pin: [],
  hide: [],
  walkSpeedMps: 1.3,
  walkDetourFactor: 1.3,
};

export function resolveConfig(search: string, base: Config = defaultConfig): Config {
  const params = new URLSearchParams(search);
  const config: Config = { ...base };

  // A different building shouldn't keep W41's place name, so ?name= without ?place= clears it.
  const name = params.get('name');
  if (name) {
    config.name = name;
    config.place = '';
  }
  const place = params.get('place');
  if (place) config.place = place;

  const palette = params.get('palette');
  if (palette && (palette === 'rotate' || isPaletteName(palette))) config.palette = palette;

  const inset = Number(params.get('inset'));
  if (Number.isFinite(inset)) config.inset = Math.min(10, Math.max(0, inset));

  const latRaw = params.get('lat');
  const lonRaw = params.get('lon');
  if (latRaw !== null && lonRaw !== null && latRaw.trim() !== '' && lonRaw.trim() !== '') {
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (Number.isFinite(lat) && Number.isFinite(lon)) config.location = { lat, lon };
  }
  return config;
}
