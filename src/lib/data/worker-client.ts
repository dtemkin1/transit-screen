import type { Config } from '../../config';
import type { Alert } from '../types';

export function workerUrl(cfg: Pick<Config, 'workerUrl'>, path: string): string {
  return `${cfg.workerUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

/** Runs fetch and body consumption under one timeout; a caller-supplied init.signal also aborts. */
async function timedFetch<T>(
  url: string, init: RequestInit | undefined, timeoutMs: number, read: (res: Response) => Promise<T>,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = init?.signal ? AbortSignal.any([init.signal, ctrl.signal]) : ctrl.signal;
  try {
    const res = await fetch(url, { ...init, signal });
    if (!res.ok) throw new HttpError(res.status, url);
    return await read(res);
  } finally {
    clearTimeout(timer);
  }
}

export function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
  return timedFetch(url, init, timeoutMs, (r) => r.json() as Promise<T>);
}

export function fetchBytes(url: string, timeoutMs = 20_000): Promise<Uint8Array> {
  return timedFetch(url, undefined, timeoutMs, async (r) => new Uint8Array(await r.arrayBuffer()));
}

/** Sends a report to the Worker, which logs it. Best effort; never throws. */
function report(cfg: Pick<Config, 'workerUrl'>, body: Record<string, unknown>): void {
  fetch(workerUrl(cfg, '/report'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}

/** Tells the Worker that the board hid an alert for its wording. */
export function reportHiddenAlert(cfg: Config, alert: Alert): void {
  report(cfg, { kind: 'hidden-alert', source: alert.source, id: alert.id, header: alert.header.slice(0, 1000) });
}

/** Errors already reported in this page load. */
const reportedErrors = new Set<string>();
/** An error repeating with every poll is sent once, and a page sends at most this many. */
const MAX_ERROR_REPORTS = 10;

/** Tells the Worker about an error the page didn't handle, so a broken screen shows up in its logs. */
export function reportError(cfg: Pick<Config, 'workerUrl'>, error: unknown): void {
  const e = error instanceof Error ? error : new Error(String(error));
  const message = `${e.name}: ${e.message}`.slice(0, 500);
  if (reportedErrors.has(message) || reportedErrors.size >= MAX_ERROR_REPORTS) return;
  reportedErrors.add(message);
  report(cfg, {
    kind: 'client-error', message, stack: e.stack?.slice(0, 2000), page: `${location.pathname}${location.search}`.slice(0, 500),
  });
}
