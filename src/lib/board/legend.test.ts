import { describe, expect, it } from 'vitest';
import { marksShown } from './legend';
import type { BoardPanel, RouteInfo, TimeCell } from '../types';

const route: RouteInfo = { id: 'R', source: 'mbta', mode: 'subway', shortName: 'R', longName: 'Red Line', color: '#DA291C', textColor: '#FFFFFF' };
const cell = (o: Partial<TimeCell> = {}): TimeCell => ({ label: '5 min', live: true, departureTime: 0, ...o });
const board = (...times: TimeCell[][]): BoardPanel[] => [{
  id: 'subway', title: 'Red Line', status: 'ok', notes: [],
  groups: [{ rows: times.map((t, i) => ({ key: `k${i}`, route, headsign: 'Alewife', times: t })) }],
}];

describe('marksShown', () => {
  it('finds neither on an all-live board', () => {
    expect(marksShown(board([cell(), cell()]))).toEqual({ scheduled: false, missable: false });
  });
  it('finds a scheduled time and a starred one, in any row', () => {
    expect(marksShown(board([cell()], [cell({ live: false })]))).toEqual({ scheduled: true, missable: false });
    expect(marksShown(board([cell({ missable: true })]))).toEqual({ scheduled: false, missable: true });
  });
  it('finds neither with no panels', () => {
    expect(marksShown([])).toEqual({ scheduled: false, missable: false });
  });
});
