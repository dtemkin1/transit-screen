import { describe, expect, it } from 'vitest';
import { trimPanel } from './trim';
import type { BoardGroup, BoardPanel, BoardRow, RouteInfo, TimeCell } from '../types';

const route: RouteInfo = { id: 'R', source: 'mbta', mode: 'subway', shortName: 'R', longName: 'Red Line', color: '#DA291C', textColor: '#FFFFFF' };
const cell = (min: number, reachable = true): TimeCell => ({ label: `${min} min`, live: true, reachable, departureTime: min * 60_000 });
const row = (key: string, times: TimeCell[]): BoardRow => ({ key, route, headsign: key, times });
const panel = (groups: BoardGroup[]): BoardPanel => ({ id: 'subway', title: 'Subway', status: 'ok', groups });
const lines = (p: BoardPanel) => p.groups.reduce((n, g) => n + (g.header ? 1 : 0) + g.rows.length, 0);
const shape = (p: BoardPanel) => p.groups.map((g) => g.rows.map((r) => `${r.key}:${r.times.map((t) => t.departureTime / 60_000).join(',')}`));

const sample = () => panel([
  { header: { name: 'Kendall', walkMin: 10 }, rows: [
    row('a', [cell(1, false), cell(12), cell(20)]),
    row('b', [cell(15), cell(25), cell(35)]),
  ] },
  { header: { name: 'Central', walkMin: 14 }, rows: [
    row('c', [cell(2, false)]),
    row('d', [cell(30), cell(40)]),
  ] },
]);

describe('trimPanel', () => {
  it('leaves a panel that fits untouched', () => {
    const p = sample();
    expect(trimPanel(p, 6)).toEqual(p);
  });

  it('one line over drops exactly one row; the others keep all their times', () => {
    // Row c has no reachable time, so it goes first even though its time is earliest.
    const p = trimPanel(sample(), 5);
    expect(shape(p)).toEqual([['a:1,12,20', 'b:15,25,35'], ['d:30,40']]);
    expect(lines(p)).toBe(5);
  });

  it('then drops rows whose next reachable departure is furthest, with empty groups and headers', () => {
    // d (30) goes and takes the Central header with it.
    const p4 = trimPanel(sample(), 4);
    expect(shape(p4)).toEqual([['a:1,12,20', 'b:15,25,35']]);
    expect(lines(p4)).toBe(3);

    // b's next reachable (15) is later than a's (12, past the unreachable 1).
    expect(shape(trimPanel(sample(), 2))).toEqual([['a:1,12,20']]);
  });

  it('drops everything when nothing fits', () => {
    expect(trimPanel(sample(), 1).groups).toEqual([]);
    expect(trimPanel(sample(), 0).groups).toEqual([]);
    expect(trimPanel(sample(), -1).groups).toEqual([]);
  });

  it('does not mutate the input', () => {
    const p = sample();
    const copy = structuredClone(p);
    trimPanel(p, 1);
    expect(p).toEqual(copy);
  });
});
