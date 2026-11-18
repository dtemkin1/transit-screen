import type { PanelStatus } from '../types';

export interface Health { lastOk: number | null }

const DELAYED_MS = 2 * 60_000;
const DROP_LIVE_MS = 10 * 60_000;

export function sourceStatus(h: Health, nowMs: number, hasSchedule: boolean): PanelStatus {
  const age = h.lastOk === null ? Infinity : nowMs - h.lastOk;
  if (age > DROP_LIVE_MS) return hasSchedule ? 'schedule-fallback' : 'unavailable';
  if (age > DELAYED_MS) return 'delayed';
  return 'ok';
}

const SEVERITY: readonly PanelStatus[] = ['ok', 'delayed', 'schedule-fallback', 'unavailable'];

export function worstStatus(statuses: PanelStatus[]): PanelStatus {
  return statuses.reduce<PanelStatus>(
    (worst, s) => (SEVERITY.indexOf(s) > SEVERITY.indexOf(worst) ? s : worst), 'ok');
}
