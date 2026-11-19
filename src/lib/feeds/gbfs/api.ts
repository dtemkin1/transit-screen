import type { Mode, Source, Station, Unit } from '../../types';

interface Feed { name: string; url: string }
interface InfoRow { station_id: string; name: string; lat: number; lon: number }
interface StatusRow {
  station_id: string;
  num_bikes_available?: number;
  num_ebikes_available?: number;
  num_docks_available?: number;
  is_installed?: number | boolean;
  is_renting?: number | boolean;
}

const stationsOf = <T>(json: unknown): T[] =>
  (json as { data?: { stations?: T[] } } | null)?.data?.stations ?? [];

export function resolveFeedUrls(json: unknown): { stationInformation: string; stationStatus: string } {
  const feeds = (json as { data?: { en?: { feeds?: Feed[] } } } | null)?.data?.en?.feeds ?? [];
  const find = (name: string): string => {
    const url = feeds.find((f) => f.name === name)?.url;
    if (!url) throw new Error(`GBFS discovery: no "${name}" feed in data.en.feeds`);
    return url;
  };
  return { stationInformation: find('station_information'), stationStatus: find('station_status') };
}

export function parseStationInfo(json: unknown, feed: { id: Source; mode: Mode; unit: Unit }): Station[] {
  return stationsOf<InfoRow>(json).map((s) => ({
    id: s.station_id, source: feed.id, mode: feed.mode, unit: feed.unit,
    name: s.name, lat: s.lat, lon: s.lon, walkSec: 0,
  }));
}

export function applyStatus(stations: Station[], json: unknown): Station[] {
  const byId = new Map(stationsOf<StatusRow>(json).map((s) => [s.station_id, s]));
  return stations.map((st) => {
    const s = byId.get(st.id);
    if (!s) return { ...st };
    return {
      ...st,
      available: s.num_bikes_available,
      electric: s.num_ebikes_available,
      docks: s.num_docks_available,
      open: (s.is_renting === 1 || s.is_renting === true) && s.is_installed !== 0 && s.is_installed !== false,
    };
  });
}
