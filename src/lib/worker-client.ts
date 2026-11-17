import type { Config } from '../config';

export function workerUrl(cfg: Config, path: string): string {
  return `${cfg.workerUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
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
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
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
