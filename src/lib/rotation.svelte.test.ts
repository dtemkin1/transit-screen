import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRotation } from './rotation.svelte';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Mimics the board: a new list object every 5 s tick, even when nothing changed. */
function setup(initial: string[]) {
  const src = $state({ items: initial });
  let rot!: ReturnType<typeof createRotation>;
  const destroy = $effect.root(() => {
    rot = createRotation(() => src.items.length, 10_000);
  });
  flushSync();
  const rerenderEvery5s = async (ms: number) => {
    for (let t = 0; t < ms; t += 5_000) {
      await vi.advanceTimersByTimeAsync(5_000);
      src.items = [...src.items];
      flushSync();
    }
  };
  return { src, rot, destroy, rerenderEvery5s };
}

describe('createRotation', () => {
  it('advances every 10 s even when the list is replaced every 5 s', async () => {
    const r = setup(['a', 'b', 'c']);
    expect(r.rot.index).toBe(0);
    await r.rerenderEvery5s(10_000);
    expect(r.rot.index).toBe(1);
    await r.rerenderEvery5s(10_000);
    expect(r.rot.index).toBe(2);
    await r.rerenderEvery5s(10_000);
    expect(r.rot.index).toBe(0);
    r.destroy();
  });

  it('stays at 0 with fewer than 2 items and keeps the index valid when the list shrinks', async () => {
    const r = setup(['a']);
    await r.rerenderEvery5s(30_000);
    expect(r.rot.index).toBe(0);
    r.src.items = ['a', 'b', 'c'];
    flushSync();
    await r.rerenderEvery5s(20_000);
    expect(r.rot.index).toBe(2);
    r.src.items = ['a', 'b'];
    flushSync();
    expect(r.rot.index).toBeLessThan(2);
    r.src.items = [];
    flushSync();
    expect(r.rot.index).toBe(0);
    r.destroy();
  });
});
