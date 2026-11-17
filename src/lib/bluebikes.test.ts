import { describe, expect, it } from 'vitest';
import { GBFS_BASE, applyStatus, parseStationInfo } from './bluebikes';
import { haversineM } from './geo';
import stationInfo from '../test/fixtures/gbfs-station_information.json';
import stationStatus from '../test/fixtures/gbfs-station_status.json';

const W41 = { lat: 42.35982, lon: -71.0961 };
const RADIUS_M = 500;

const MASS_AVE_ALBANY = 'f6df6c1a-064f-428a-951c-2069a081b9df'; // 178 m from W41, 2 bikes
const LAFAYETTE_SQUARE = 'f8349824-0de8-11e7-991c-3863bb43a7d0'; // 547 m from W41, 1 bike, 1 e-bike
const MIT_STATA = 'f8349de4-0de8-11e7-991c-3863bb43a7d0'; // 481 m from W41, empty

describe('parseStationInfo', () => {
  it('within radius only (sorted by distance, walkSec 0)', () => {
    const stations = parseStationInfo(stationInfo, W41, RADIUS_M);
    expect(stations.map((s) => s.id)).toEqual([
      'f6df6c1a-064f-428a-951c-2069a081b9df',
      'f83493c0-0de8-11e7-991c-3863bb43a7d0',
      'f835141c-0de8-11e7-991c-3863bb43a7d0',
      'f83513a7-0de8-11e7-991c-3863bb43a7d0',
      'f8349de4-0de8-11e7-991c-3863bb43a7d0',
    ]);
    for (const s of stations) {
      expect(haversineM(W41, s)).toBeLessThanOrEqual(RADIUS_M);
      expect(s.walkSec).toBe(0);
    }
    const src = stationInfo.data.stations.find((s) => s.station_id === MASS_AVE_ALBANY);
    expect(stations[0]).toEqual({
      id: MASS_AVE_ALBANY,
      name: src?.name,
      lat: src?.lat,
      lon: src?.lon,
      walkSec: 0,
    });
  });

  it('exposes the GBFS base URL', () => {
    expect(GBFS_BASE).toBe('https://gbfs.lyft.com/gbfs/2.3/bos/en/');
  });
});

describe('applyStatus', () => {
  const stations = parseStationInfo(stationInfo, W41, 1000); // all 10 fixture stations

  it('applies counts', () => {
    const out = applyStatus(stations, stationStatus);
    const byId = new Map(out.map((s) => [s.id, s]));

    expect(byId.get(MASS_AVE_ALBANY)).toMatchObject({ bikes: 2, ebikes: 0, docks: 16, renting: true });
    expect(byId.get(LAFAYETTE_SQUARE)).toMatchObject({ bikes: 1, ebikes: 1, docks: 13, renting: true });
    expect(byId.get(MIT_STATA)).toMatchObject({ bikes: 0, ebikes: 0, docks: 34, renting: true });
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
    expect(station?.bikes).toBeUndefined();
    expect(station?.ebikes).toBeUndefined();
    expect(station?.docks).toBeUndefined();
    expect(station?.renting).toBeUndefined();
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
    expect(byId.get(MASS_AVE_ALBANY)?.renting).toBe(false);
    expect(byId.get(LAFAYETTE_SQUARE)?.renting).toBe(false);
  });

  it('does not mutate the input stations', () => {
    applyStatus(stations, stationStatus);
    expect(stations[0].bikes).toBeUndefined();
  });
});
