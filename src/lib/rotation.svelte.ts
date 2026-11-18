/**
 * Index into a list of `count()` items that advances every `everyMs` while there are 2 or more.
 * The timer depends only on the count, so a caller that hands in a new list object of the
 * same length (the board rebuilds every 5 s) does not restart it.
 */
export function createRotation(count: () => number, everyMs: number) {
  let tick = $state(0);
  const n = $derived(count());

  $effect(() => {
    if (n < 2) return;
    const id = setInterval(() => tick++, everyMs);
    return () => clearInterval(id);
  });

  return {
    get index() {
      return n > 0 ? tick % n : 0;
    },
  };
}
