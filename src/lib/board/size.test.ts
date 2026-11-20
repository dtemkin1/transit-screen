import { describe, expect, it } from 'vitest';
import { PANELS } from './panels';
import { panelFloor, panelNeed, panelRows, priorityFactor, splitColumn, uncappedPanel } from './size';
import type { BoardPanel, Mode, PanelId, ServiceRow, Source, Station, Stop } from '../types';

const DEFAULT: PanelId[] = ['subway', 'bus', 'shuttle', 'bikes'];
const def = (id: PanelId) => PANELS.find((p) => p.id === id)!;

const stop = (source: Source, mode: Mode, id: string) => ({ source, mode, id }) as Stop;
const row = (mode: Mode, key: string, stopId = '', routeId = key.split(':')[0]): ServiceRow => ({ mode, key, stopId, routeId });
const stops = [stop('mbta', 'subway', 'place-knncl'), stop('mbta', 'bus', '2231'), stop('ezride', 'bus', 'ez1')];
const bikes = [1, 2, 3].map((i) => ({ source: 'bluebikes', mode: 'bikes', id: `b${i}` }) as Station);

describe('panelRows', () => {
  it('is the need, at least one row', () => {
    expect(panelRows(def('bus'), 12)).toBe(12);
    expect(panelRows(def('bus'), 0)).toBe(1);
  });
  it('falls back to the fixed share at 3 rows each when need is unknown', () => {
    expect(panelRows(def('subway'), undefined)).toBe(9);
  });
  it('is 0 for a panel with nothing to list, leaving just its notes', () => {
    expect(panelRows(def('subway'), 9, true)).toBe(0);
  });
});

describe('priorityFactor', () => {
  it('is 1.25 per step above the last panel in priority', () => {
    expect(priorityFactor('subway', DEFAULT)).toBe(1.953125);
    expect(priorityFactor('bus', DEFAULT)).toBe(1.5625);
    expect(priorityFactor('bikes', DEFAULT)).toBe(1);
  });
  it('follows a configured order, and ranks a missing panel last', () => {
    expect(priorityFactor('shuttle', ['shuttle', 'subway', 'bus', 'bikes'])).toBe(1.953125);
    expect(priorityFactor('bikes', ['subway'])).toBe(1);
  });
});

describe('panelNeed', () => {
  it('counts subway rows per station, plus a station header each', () => {
    const service = { mbta: [row('subway', 'Red:0', 'place-knncl'), row('subway', 'Red:1', 'place-knncl')], ezride: [] };
    expect(panelNeed(def('subway'), { stops, stations: [] }, service)).toBeCloseTo(2.58);
    service.mbta.push(row('subway', 'Red:0', 'place-cntsq'));
    expect(panelNeed(def('subway'), { stops, stations: [] }, service)).toBeCloseTo(3 + 2 * 0.58);
  });
  it('counts each direction once across stops, summed over the panel\'s feeds', () => {
    const service = { mbta: [row('bus', '1:0'), row('bus', '1:1'), row('bus', '1:0', 'x')], ezride: [row('bus', 'Kendall')] };
    expect(panelNeed(def('bus'), { stops, stations: [] }, service)).toBe(3);
  });
  it('is unknown while a feed with stops in the panel has not reported', () => {
    expect(panelNeed(def('bus'), { stops, stations: [] }, { mbta: [row('bus', '1:0')] })).toBeUndefined();
  });
  it('is 0 for a panel with no stops', () => {
    expect(panelNeed(def('shuttle'), { stops, stations: [] }, {})).toBe(0);
  });
  it('counts bike stations', () => {
    expect(panelNeed(def('bikes'), { stops, stations: bikes }, {})).toBe(3);
  });
  it('leaves out routes hidden by id or source:id, as the board does', () => {
    const service = { mbta: [row('bus', '1:0'), row('bus', '70:0'), row('bus', '85:0')], ezride: [row('bus', 'Kendall', '', '6448')] };
    expect(panelNeed(def('bus'), { stops, stations: [] }, service, ['mbta:70', '6448'])).toBe(2);
  });
});

describe('uncappedPanel', () => {
  it('is the column\'s highest-priority panel, which takes the room the others can\'t fill', () => {
    expect(uncappedPanel(['subway', 'bikes'], DEFAULT)).toBe('subway');
    expect(uncappedPanel(['bus', 'shuttle'], ['shuttle', 'subway', 'bus', 'bikes'])).toBe('shuttle');
  });
  it('falls back to the first panel when none is in the order', () => {
    expect(uncappedPanel(['bus', 'shuttle'], ['subway'])).toBe('bus');
  });
  it('passes over a panel with nothing to list, which has no use for the room', () => {
    expect(uncappedPanel(['subway', 'bikes'], DEFAULT, ['subway'])).toBe('bikes');
    expect(uncappedPanel(['subway', 'bikes'], DEFAULT, ['subway', 'bikes'])).toBe('subway');
  });
});

describe('splitColumn', () => {
  const item = (start: number, floor: number, shrink = 1, grow = 0) => ({ start, floor, shrink, grow });
  it('gives each panel its start, and the spare room to the one that grows', () => {
    expect(splitColumn(500, 0, [item(200, 50, 1, 1), item(100, 50)])).toEqual([400, 100]);
  });
  it('leaves the gaps between panels out of the room', () => {
    expect(splitColumn(310, 10, [item(200, 50, 1, 1), item(100, 50)])).toEqual([200, 100]);
  });
  it('shrinks a short column in proportion to each start times its shrink', () => {
    const [a, b] = splitColumn(250, 0, [item(200, 50), item(100, 50)])!;
    expect(a).toBeCloseTo(166.67);
    expect(b).toBeCloseTo(83.33);
    expect(splitColumn(250, 0, [item(200, 50, 0.5), item(100, 50)])).toEqual([175, 75]);
  });
  it('stops a panel at its floor and takes the rest from the others', () => {
    expect(splitColumn(160, 0, [item(200, 50), item(100, 90)])).toEqual([70, 90]);
  });
  it('is null when the floors alone do not fit', () => {
    expect(splitColumn(100, 0, [item(200, 50), item(100, 60)])).toBeNull();
    expect(splitColumn(115, 10, [item(200, 50), item(100, 60)])).toBeNull();
  });
});

describe('panelFloor', () => {
  const panel = (over: Partial<BoardPanel>): BoardPanel =>
    ({ id: 'bus', title: 'Buses', status: 'ok', groups: [{ rows: [] }], notes: [], ...over });
  it('is one row, or a row and its station header for the subway', () => {
    expect(panelFloor(panel({}), 0)).toBe(1);
    expect(panelFloor(panel({ groups: [{ header: { name: 'Kendall', walkMin: 3, walkEstimated: false }, rows: [] }] }), 0)).toBeCloseTo(1.58);
  });
  it('fits every "unavailable" note a panel with nothing to list shows, with room under the last', () => {
    expect(panelFloor(panel({}), 1)).toBeCloseTo(2 / 2.5);
    expect(panelFloor(panel({}), 2)).toBeCloseTo(3.6 / 2.5);
  });
});
