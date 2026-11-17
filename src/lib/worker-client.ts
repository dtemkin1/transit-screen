import type { Config } from '../config';

export function workerUrl(cfg: Config, path: string): string {
  return `${cfg.workerUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function timedFetch(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
  return (await (await timedFetch(url, init, timeoutMs)).json()) as T;
}

export async function fetchBytes(url: string, timeoutMs = 20_000): Promise<Uint8Array> {
  return new Uint8Array(await (await timedFetch(url, undefined, timeoutMs)).arrayBuffer());
}
