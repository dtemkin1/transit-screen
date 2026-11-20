import { describe, expect, it } from 'vitest';
import { steadyTimes } from './steady';
import type { Departure } from '../types';

const SEC = 1000;
const dep = (tripId: string | undefined, departureTime: number, stopId = '70071'): Departure => ({
  source: 'mbta', mode: 'subway', routeId: 'Red', stopId, directionKey: 'Red:0', headsign: 'Ashmont',
  departureTime, arrivalTime: departureTime - 30 * SEC, live: true, tripId,
});

describe('steadyTimes', () => {
  it('takes a trip\'s first prediction as is', () => {
    const { departures } = steadyTimes(new Map(), [dep('a', 240 * SEC)]);
    expect(departures[0].departureTime).toBe(240 * SEC);
  });

  it('keeps the earlier time while a prediction moves later by less than 30 s, so the minute shown doesn\'t bounce', () => {
    const first = steadyTimes(new Map(), [dep('a', 239 * SEC)]);
    const next = steadyTimes(first.kept, [dep('a', 241 * SEC)]);
    expect(next.departures[0].departureTime).toBe(239 * SEC);
    expect(next.departures[0].arrivalTime).toBe(211 * SEC);
  });

  it('takes an earlier prediction at once, so the board never shows a train later than predicted', () => {
    const first = steadyTimes(new Map(), [dep('a', 240 * SEC)]);
    const next = steadyTimes(first.kept, [dep('a', 230 * SEC)]);
    expect(next.departures[0].departureTime).toBe(230 * SEC);
    expect(next.kept.get('mbta:a|70071')).toBe(230 * SEC);
  });

  it('takes a move of 30 s or more straight away', () => {
    const first = steadyTimes(new Map(), [dep('a', 240 * SEC)]);
    const next = steadyTimes(first.kept, [dep('a', 270 * SEC)]);
    expect(next.departures[0].departureTime).toBe(270 * SEC);
  });

  it('measures drift from the kept time, so small steps can\'t add up unseen', () => {
    let kept = steadyTimes(new Map(), [dep('a', 240 * SEC)]).kept;
    let last = 0;
    for (const t of [255, 265, 275]) {
      const r = steadyTimes(kept, [dep('a', t * SEC)]);
      kept = r.kept;
      last = r.departures[0].departureTime;
    }
    expect(last).toBe(275 * SEC);
  });

  it('keeps each trip at each stop apart, and passes through a departure with no trip', () => {
    const first = steadyTimes(new Map(), [dep('a', 240 * SEC, '70071'), dep('a', 300 * SEC, '70072')]);
    const next = steadyTimes(first.kept, [dep('a', 250 * SEC, '70071'), dep('a', 310 * SEC, '70072'), dep(undefined, 99 * SEC)]);
    expect(next.departures.map((d) => d.departureTime)).toEqual([240 * SEC, 300 * SEC, 99 * SEC]);
  });

  it('forgets trips no longer in the feed', () => {
    const first = steadyTimes(new Map(), [dep('a', 240 * SEC)]);
    const gone = steadyTimes(first.kept, []);
    expect(gone.kept.size).toBe(0);
  });
});
