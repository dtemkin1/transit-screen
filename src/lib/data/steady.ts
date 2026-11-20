import type { Departure } from '../types';

/** A smaller move later is jitter: the time already shown is kept, so "3 min" doesn't flip back to "4 min". */
const TOLERANCE_MS = 30_000;

const keyOf = (d: Departure) => (d.tripId === undefined ? undefined : `${d.source}:${d.tripId}|${d.stopId}`);

/**
 * Live departures with each trip's time held while its prediction moves later by under 30 s, so a
 * countdown doesn't bounce; earlier moves show at once. ARR keeps the raw arrival.
 */
export function steadyTimes(
  previous: ReadonlyMap<string, number>, departures: readonly Departure[],
): { departures: Departure[]; kept: Map<string, number> } {
  const kept = new Map<string, number>();
  const out = departures.map((d) => {
    const key = keyOf(d);
    if (key === undefined) return d;
    const before = previous.get(key);
    const drift = before === undefined ? Infinity : d.departureTime - before;
    const time = drift >= 0 && drift < TOLERANCE_MS ? before! : d.departureTime;
    kept.set(key, time);
    return time === d.departureTime ? d : { ...d, departureTime: time };
  });
  return { departures: out, kept };
}
