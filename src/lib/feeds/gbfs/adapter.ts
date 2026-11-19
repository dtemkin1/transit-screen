import { applyStatus, parseStationInfo, resolveFeedUrls } from './api';
import type { Adapter, GbfsFeed } from '../types';

interface Status { last_updated?: unknown; ttl?: unknown }

export const gbfs: Adapter<GbfsFeed, { statusUrl: string }> = {
  async candidates(feed, { fetchJson }) {
    const { stationInformation, stationStatus } = resolveFeedUrls(await fetchJson<unknown>(feed.url));
    const stations = parseStationInfo(await fetchJson<unknown>(stationInformation), feed);
    return { data: { statusUrl: stationStatus }, stations };
  },

  polls: () => [{
    name: 'status', everyMs: 60_000,
    async run(scope, { fetchJson }) {
      if (scope.stations.length === 0) return undefined;
      const json = await fetchJson<Status | null>(scope.data.statusUrl);
      return { stations: applyStatus(scope.stations, json), fresh: { at: json?.last_updated, validFor: json?.ttl } };
    },
  }],
};
