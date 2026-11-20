import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportError } from './worker-client';

afterEach(() => vi.unstubAllGlobals());

describe('reportError', () => {
  it('sends each error once, and at most 10 per page load', () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('location', { pathname: '/', search: '?building=32' });
    const cfg = { workerUrl: 'https://w.example/' };

    reportError(cfg, new TypeError('x is undefined'));
    reportError(cfg, new TypeError('x is undefined'));
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://w.example/report');
    expect(JSON.parse(init.body as string)).toMatchObject({
      kind: 'client-error', message: 'TypeError: x is undefined', page: '/?building=32',
    });

    for (let i = 0; i < 20; i++) reportError(cfg, `failure ${i}`);
    expect(fetch).toHaveBeenCalledTimes(10);
  });
});
