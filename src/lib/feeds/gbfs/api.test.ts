import { describe, expect, it } from 'vitest';
import { applyStatus, parseStationInfo, resolveFeedUrls } from './api';
import discovery from '../../../test/fixtures/gbfs-discovery.json';
import stationInfo from '../../../test/fixtures/gbfs-station_information.json';
import stationStatus from '../../../test/fixtures/gbfs-station_status.json';

const FEED = { id: 'bluebikes', mode: 'bikes', unit: { one: 'bike', electric: 'e-bike' } } as const;

const MASS_AVE_ALBANY = 'f6df6c1a-064f-428a-951c-2069a081b9df'; // 178 m from W41, 2 bikes
const MIT_AMHERST = 'f83493c0-0de8-11e7-991c-3863bb43a7d0'; // 287 m from W41, 2 bikes, 1 e-bike
const LAFAYETTE_SQUARE = 'f8349824-0de8-11e7-991c-3863bb43a7d0'; // 547 m from W41, empty
const MIT_STATA = 'f8349de4-0de8-11e7-991c-3863bb43a7d0'; // 481 m from W41, empty

describe('parseStationInfo', () => {
  it('reads every station, tagged with its feed (discovery applies the walk limit)', () => {
    const stations = parseStationInfo(stationInfo, FEED);
    expect(stations).toHaveLength(stationInfo.data.stations.length);
    const src = stationInfo.data.stations.find((s) => s.station_id === MASS_AVE_ALBANY);
    expect(stations.find((s) => s.id === MASS_AVE_ALBANY)).toEqual({
      id: MASS_AVE_ALBANY, source: 'bluebikes', mode: 'bikes', unit: FEED.unit,
      name: src?.name, lat: src?.lat, lon: src?.lon, walkSec: 0,
    });
  });
});

describe('resolveFeedUrls', () => {
  it('returns the station_information and station_status feed URLs from data.en.feeds', () => {
    expect(resolveFeedUrls(discovery)).toEqual({
      stationInformation: 'https://gbfs.lyft.com/gbfs/1.1/bos/en/station_information.json',
      stationStatus: 'https://gbfs.lyft.com/gbfs/1.1/bos/en/station_status.json',
    });
  });

  it('throws a clear error when station_information is missing', () => {
    const feeds = discovery.data.en.feeds.filter((f) => f.name !== 'station_information');
    expect(() => resolveFeedUrls({ data: { en: { feeds } } })).toThrow(/station_information/);
  });

  it('throws a clear error when station_status is missing', () => {
    const feeds = discovery.data.en.feeds.filter((f) => f.name !== 'station_status');
    expect(() => resolveFeedUrls({ data: { en: { feeds } } })).toThrow(/station_status/);
  });

  it('throws when the discovery document has no English feeds', () => {
    expect(() => resolveFeedUrls({})).toThrow(/station_information/);
  });
});

describe('applyStatus', () => {
  const stations = parseStationInfo(stationInfo, FEED);

  it('applies counts', () => {
    const out = applyStatus(stations, stationStatus);
    const byId = new Map(out.map((s) => [s.id, s]));

    expect(byId.get(MASS_AVE_ALBANY)).toMatchObject({ available: 2, electric: 0, docks: 16, open: true });
    expect(byId.get(MIT_AMHERST)).toMatchObject({ available: 2, electric: 1, docks: 27, open: true });
    expect(byId.get(LAFAYETTE_SQUARE)).toMatchObject({ available: 0, electric: 0, docks: 13, open: true });
    expect(byId.get(MIT_STATA)).toMatchObject({ available: 0, electric: 0, docks: 34, open: true });
  });

  it('missing status → undefined counts', () => {
    const withoutStata = {
      ...stationStatus,
      data: { stations: stationStatus.data.stations.filter((s) => s.station_id !== MIT_STATA) },
    };
    const out = applyStatus(stations, withoutStata);
    const station = out.find((s) => s.id === MIT_STATA);
    expect(station).toBeDefined();
    expect(station).toMatchObject({ name: 'MIT Stata Center at Vassar St / Main St' });
    expect(station?.available).toBeUndefined();
    expect(station?.electric).toBeUndefined();
    expect(station?.docks).toBeUndefined();
    expect(station?.open).toBeUndefined();
  });

  it('marks a station closed when is_renting is 0 or it is not installed', () => {
    const status = {
      data: {
        stations: [
          { station_id: MASS_AVE_ALBANY, num_bikes_available: 2, num_docks_available: 16, is_installed: 1, is_renting: 0 },
          { station_id: LAFAYETTE_SQUARE, num_bikes_available: 1, num_docks_available: 13, is_installed: 0, is_renting: 1 },
        ],
      },
    };
    const byId = new Map(applyStatus(stations, status).map((s) => [s.id, s]));
    expect(byId.get(MASS_AVE_ALBANY)?.open).toBe(false);
    expect(byId.get(LAFAYETTE_SQUARE)?.open).toBe(false);
  });

  it('reads GBFS 2.x/3.x boolean is_renting and is_installed', () => {
    const status = {
      data: {
        stations: [
          { station_id: MASS_AVE_ALBANY, num_bikes_available: 2, num_docks_available: 16, is_installed: true, is_renting: true },
          { station_id: LAFAYETTE_SQUARE, num_bikes_available: 1, num_docks_available: 13, is_installed: true, is_renting: false },
          { station_id: 'x', num_bikes_available: 1, num_docks_available: 13, is_installed: false, is_renting: true },
        ],
      },
    };
    const byId = new Map(applyStatus([...stations, { ...stations[0], id: 'x', name: 'x' }], status).map((s) => [s.id, s]));
    expect(byId.get(MASS_AVE_ALBANY)?.open).toBe(true);
    expect(byId.get(LAFAYETTE_SQUARE)?.open).toBe(false);
    expect(byId.get('x')?.open).toBe(false);
  });

  it('does not mutate the input stations', () => {
    applyStatus(stations, stationStatus);
    expect(stations[0].available).toBeUndefined();
  });
});
