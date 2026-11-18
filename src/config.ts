import type { LatLon, Mode } from './lib/types';

export interface ModeLimit { maxWalkMin: number; maxStations?: number }
export interface Config {
  name: string; location: LatLon; workerUrl: string;
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
  location: { lat: 42.35982, lon: -71.0961 },
  workerUrl: pickWorkerUrl(import.meta.env.VITE_WORKER_URL),
  modes: {
    subway: { maxWalkMin: 15 },
    bus: { maxWalkMin: 5 },
    ezride: { maxWalkMin: 6 },
    shuttle: { maxWalkMin: 5 },
    bikes: { maxWalkMin: 4, maxStations: 4 },
  },
  pin: [],
  hide: [],
  walkSpeedMps: 1.3,
  walkDetourFactor: 1.3,
};

export function resolveConfig(search: string, base: Config = defaultConfig): Config {
  const params = new URLSearchParams(search);
  const config: Config = { ...base };

  const name = params.get('name');
  if (name) config.name = name;

  const latRaw = params.get('lat');
  const lonRaw = params.get('lon');
  if (latRaw !== null && lonRaw !== null && latRaw.trim() !== '' && lonRaw.trim() !== '') {
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (Number.isFinite(lat) && Number.isFinite(lon)) config.location = { lat, lon };
  }
  return config;
}
