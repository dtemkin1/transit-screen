import { describe, expect, it } from 'vitest';
import { trimPanel } from './trim';
import type { BoardGroup, BoardPanel, BoardRow, RouteInfo, TimeCell } from '../types';

const route: RouteInfo = { id: 'R', source: 'mbta', mode: 'subway', shortName: 'R', longName: 'Red Line', color: '#DA291C', textColor: '#FFFFFF' };
const cell = (min: number): TimeCell => ({ label: `${min} min`, live: true, departureTime: min * 60_000 });
const row = (key: string, times: TimeCell[]): BoardRow => ({ key, route, headsign: key, times });
const panel = (groups: BoardGroup[]): BoardPanel => ({ id: 'subway', title: 'Subway', status: 'ok', groups });
const lines = (p: BoardPanel) => p.groups.reduce((n, g) => n + (g.header ? 1 : 0) + g.rows.length, 0);
const shape = (p: BoardPanel) => p.groups.map((g) => g.rows.map((r) => `${r.key}:${r.times.map((t) => t.departureTime / 60_000).join(',')}`));

const sample = () => panel([
  { header: { name: 'Kendall', walkMin: 10, walkEstimated: false }, rows: [
    row('a', [cell(12), cell(20)]),
    row('b', [cell(15), cell(25), cell(35)]),
  ] },
  { header: { name: 'Central', walkMin: 14, walkEstimated: false }, rows: [
    row('c', [cell(45)]),
    row('d', [cell(30), cell(40)]),
  ] },
]);

describe('trimPanel', () => {
  it('leaves a panel that fits untouched', () => {
    const p = sample();
    expect(trimPanel(p, 6)).toEqual(p);
  });

  it('one line over drops exactly one row; the others keep all their times', () => {
    // Row c's next departure (45) is the furthest away, so it goes first.
    const p = trimPanel(sample(), 5);
    expect(shape(p)).toEqual([['a:12,20', 'b:15,25,35'], ['d:30,40']]);
    expect(lines(p)).toBe(5);
  });

  it('then drops rows whose next departure is furthest, with empty groups and headers', () => {
    // d (30) goes and takes the Central header with it.
    const p4 = trimPanel(sample(), 4);
    expect(shape(p4)).toEqual([['a:12,20', 'b:15,25,35']]);
    expect(lines(p4)).toBe(3);

    // b's next departure (15) is later than a's (12).
    expect(shape(trimPanel(sample(), 2))).toEqual([['a:12,20']]);
  });

  it('drops everything when nothing fits', () => {
    expect(trimPanel(sample(), 1).groups).toEqual([]);
    expect(trimPanel(sample(), 0).groups).toEqual([]);
    expect(trimPanel(sample(), -1).groups).toEqual([]);
  });

  it('counts a station header as headerWeight lines', () => {
    // 4 rows + 2 half-height headers = 5 lines: fits in 5, but not in 4.5.
    expect(trimPanel(sample(), 5, 0.5).groups.flatMap((g) => g.rows).length).toBe(4);
    expect(trimPanel(sample(), 4.5, 0.5).groups.flatMap((g) => g.rows).length).toBe(3);
  });

  it('does not mutate the input', () => {
    const p = sample();
    const copy = structuredClone(p);
    trimPanel(p, 1);
    expect(p).toEqual(copy);
  });
});
