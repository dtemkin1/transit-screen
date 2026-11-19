import { describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../config';
import { lookupBuilding } from './building';
import { HttpError } from './worker-client';

const cfg = { ...defaultConfig, workerUrl: 'https://w.example' };

describe('lookupBuilding', () => {
  it('asks the Worker for the building', async () => {
    const get = vi.fn(async () => ({ number: '32', name: 'Stata', lat: 1, lon: 2 }));
    expect(await lookupBuilding(cfg, '32', get as never)).toEqual({ number: '32', name: 'Stata', lat: 1, lon: 2 });
    expect(get).toHaveBeenCalledWith('https://w.example/building/32');
  });
  it('an unknown building is null; any other failure is an error', async () => {
    expect(await lookupBuilding(cfg, 'X9', (async () => { throw new HttpError(404, 'u'); }) as never)).toBeNull();
    await expect(lookupBuilding(cfg, '32', (async () => { throw new HttpError(502, 'u'); }) as never)).rejects.toThrow();
  });
});
