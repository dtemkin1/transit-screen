import { it, expect } from 'vitest';
import { serviceDate, gtfsTimeToEpoch, weekdayOf, msUntilNext } from './time';

it('serviceDate before 3am is previous day', () =>
  expect(serviceDate(Date.parse('2026-11-18T06:05:00Z'))).toBe('20261117')); // 01:05 EST
it('serviceDate after 3am is same day', () =>
  expect(serviceDate(Date.parse('2026-11-18T08:05:00Z'))).toBe('20261118')); // 03:05 EST
it('gtfsTimeToEpoch handles 25:10', () =>
  expect(new Date(gtfsTimeToEpoch('20261117', '25:10:00')).toISOString()).toBe('2026-11-18T06:10:00.000Z'));
it('gtfsTimeToEpoch is EDT-aware in summer', () =>
  expect(new Date(gtfsTimeToEpoch('20260715', '18:00:00')).toISOString()).toBe('2026-07-15T22:00:00.000Z'));
it('weekdayOf', () => expect(weekdayOf('20261117')).toBe('tuesday'));
it('msUntilNext at 03:00 EST for 4am is 1 h', () =>
  expect(msUntilNext(4, Date.parse('2026-11-17T08:00:00Z'))).toBe(3_600_000));
it('msUntilNext at exactly 04:00 rolls to next day', () =>
  expect(msUntilNext(4, Date.parse('2026-11-17T09:00:00Z'))).toBe(24 * 3_600_000));
