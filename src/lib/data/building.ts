import type { Config } from '../../config';
import { HttpError, workerUrl, type fetchJson } from './worker-client';

/** An MIT building as the campus map (whereis.mit.edu) knows it; `name` is '' when it has none. */
export interface Building { number: string; name: string; lat: number; lon: number }

/** Looks up a building number through the Worker; null when the campus map has no such building. */
export async function lookupBuilding(cfg: Config, number: string, get: typeof fetchJson): Promise<Building | null> {
  try {
    return await get<Building>(workerUrl(cfg, `/building/${encodeURIComponent(number)}`));
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}
