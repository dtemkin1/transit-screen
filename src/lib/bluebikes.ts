import { haversineM } from './geo';
import type { BikeStation, LatLon } from './types';

export const GBFS_BASE = 'https://gbfs.lyft.com/gbfs/2.3/bos/en/';

interface InfoRow { station_id: string; name: string; lat: number; lon: number }
interface StatusRow {
  station_id: string;
  num_bikes_available?: number;
  num_ebikes_available?: number;
  num_docks_available?: number;
  is_installed?: number;
  is_renting?: number;
}

const stationsOf = <T>(json: unknown): T[] =>
  (json as { data?: { stations?: T[] } } | null)?.data?.stations ?? [];

export function parseStationInfo(json: unknown, origin: LatLon, radiusM: number): BikeStation[] {
  return stationsOf<InfoRow>(json)
    .map((s) => ({ s, d: haversineM(origin, s) }))
    .filter(({ d }) => d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .map(({ s }) => ({ id: s.station_id, name: s.name, lat: s.lat, lon: s.lon, walkSec: 0 }));
}

export function applyStatus(stations: BikeStation[], json: unknown): BikeStation[] {
  const byId = new Map(stationsOf<StatusRow>(json).map((s) => [s.station_id, s]));
  return stations.map((st) => {
    const s = byId.get(st.id);
    if (!s) return { ...st };
    return {
      ...st,
      bikes: s.num_bikes_available,
      ebikes: s.num_ebikes_available,
      docks: s.num_docks_available,
      renting: s.is_renting === 1 && s.is_installed !== 0,
    };
  });
}
