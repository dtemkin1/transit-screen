import { describe, expect, it } from 'vitest';
import { sourceStatus } from './health';

const MIN = 60_000;
const now = 100 * MIN;

describe('sourceStatus', () => {
  it('fresh → ok', () => expect(sourceStatus({ lastOk: now - MIN }, now, true)).toBe('ok'));
  it('exactly 2 min → ok', () => expect(sourceStatus({ lastOk: now - 2 * MIN }, now, true)).toBe('ok'));
  it('3 min old → delayed', () => expect(sourceStatus({ lastOk: now - 3 * MIN }, now, true)).toBe('delayed'));
  it('exactly 10 min → delayed', () => expect(sourceStatus({ lastOk: now - 10 * MIN }, now, false)).toBe('delayed'));
  it('11 min, schedule → schedule-fallback', () => expect(sourceStatus({ lastOk: now - 11 * MIN }, now, true)).toBe('schedule-fallback'));
  it('11 min, none → unavailable', () => expect(sourceStatus({ lastOk: now - 11 * MIN }, now, false)).toBe('unavailable'));
  it('never ok → fallback or unavailable', () => {
    expect(sourceStatus({ lastOk: null }, now, true)).toBe('schedule-fallback');
    expect(sourceStatus({ lastOk: null }, now, false)).toBe('unavailable');
  });
});
