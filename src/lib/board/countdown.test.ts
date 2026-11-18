import { describe, expect, it } from 'vitest';
import { countdownLabel } from './countdown';
import type { Departure } from '../types';

interface Opts { dep: number; arr?: number; stopped?: boolean; status?: string; live?: boolean }
const make = (mode: 'subway' | 'bus') => (o: Opts): Departure => ({
  source: 'mbta', mode, routeId: 'R', stopId: 'p', directionKey: 'R:0', headsign: 'H',
  departureTime: o.dep * 1000,
  arrivalTime: o.arr === undefined ? undefined : o.arr * 1000,
  live: o.live ?? true, status: o.status, vehicleStoppedHere: o.stopped,
});
const sub = make('subway');
const bus = make('bus');

describe('countdownLabel', () => {
  it('BRD when stopped and ≤90s', () => expect(countdownLabel(sub({ dep: 80, stopped: true }), 0)).toBe('BRD'));
  it('not BRD when stopped but >90s', () => expect(countdownLabel(sub({ dep: 95, stopped: true }), 0)).toBe('1 min'));
  it('ARR when arrival ≤30s', () => expect(countdownLabel(sub({ dep: 70, arr: 20 }), 0)).toBe('ARR'));
  it('not ARR when arrival >30s', () => expect(countdownLabel(sub({ dep: 70, arr: 31 }), 0)).toBe('1 min'));
  it('subway <60s is "1 min"', () => expect(countdownLabel(sub({ dep: 45 }), 0)).toBe('1 min'));
  it('subway at 0s is "1 min"', () => expect(countdownLabel(sub({ dep: 0 }), 0)).toBe('1 min'));
  it('subway minutes round down', () => expect(countdownLabel(sub({ dep: 179 }), 0)).toBe('2 min'));
  it('bus <60s is "Now"', () => expect(countdownLabel(bus({ dep: 45 }), 0)).toBe('Now'));
  it('bus minutes round down', () => expect(countdownLabel(bus({ dep: 600 }), 0)).toBe('10 min'));
  it('bus ignores BRD/ARR', () => expect(countdownLabel(bus({ dep: 45, arr: 10, stopped: true }), 0)).toBe('Now'));
  it('past departure is null', () => expect(countdownLabel(bus({ dep: -5 }), 0)).toBeNull());
  it('past subway departure is null outside the 30 s BRD/ARR grace', () => {
    expect(countdownLabel(sub({ dep: -5 }), 0)).toBeNull();
    expect(countdownLabel(sub({ dep: -30, stopped: true }), 0)).toBe('BRD');
    expect(countdownLabel(sub({ dep: -31, stopped: true }), 0)).toBeNull();
    expect(countdownLabel(sub({ dep: -30, arr: -40 }), 0)).toBe('ARR');
    expect(countdownLabel(sub({ dep: -31, arr: -40 }), 0)).toBeNull();
    expect(countdownLabel(sub({ dep: -500, arr: -530 }), 0)).toBeNull();
  });
  it('scheduled departure never shows ARR/BRD', () => {
    expect(countdownLabel(sub({ dep: 20, arr: 10, live: false }), 0)).toBe('1 min');
    expect(countdownLabel(sub({ dep: 80, stopped: true, live: false }), 0)).toBe('1 min');
    expect(countdownLabel(sub({ dep: -5, arr: -40, live: false }), 0)).toBeNull();
  });
  it('more than 60 min away is null', () => {
    expect(countdownLabel(bus({ dep: 3600 }), 0)).toBe('60 min');
    expect(countdownLabel(bus({ dep: 3601 }), 0)).toBeNull();
  });
  it('status wins', () => expect(countdownLabel(sub({ dep: 300, status: 'Stopped 1 stop away' }), 0)).toBe('Stopped 1 stop away'));
  it('status does not resurrect a past departure', () => expect(countdownLabel(sub({ dep: -5, status: 'Delayed' }), 0)).toBeNull());
  it('uses nowMs', () => expect(countdownLabel(bus({ dep: 1000 }), 400_000)).toBe('10 min'));
});
