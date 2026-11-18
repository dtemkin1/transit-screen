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

  it('trims in order: unreachable, times, rows', () => {
    // Step 1: dropping unreachable cells empties row c → 5 lines.
    const s1 = trimPanel(sample(), 5);
    expect(shape(s1)).toEqual([['a:12,20', 'b:15,25,35'], ['d:30,40']]);

    // Step 2 reduces to 2 then 1 time, which saves no lines; step 3 drops the
    // row whose first time is latest (d, 30), and its now-empty group goes too.
    const s3 = trimPanel(sample(), 4);
    expect(shape(s3)).toEqual([['a:12', 'b:15']]);
    expect(lines(s3)).toBe(3);

    const s4 = trimPanel(sample(), 2);
    expect(shape(s4)).toEqual([['a:12']]);
  });

  it('drops everything when nothing fits', () => {
    expect(trimPanel(sample(), 0).groups).toEqual([]);
  });

  it('does not mutate the input', () => {
    const p = sample();
    const copy = structuredClone(p);
    trimPanel(p, 1);
    expect(p).toEqual(copy);
  });
});
