// Index that advances every `everyMs` while count() >= 2. The timer depends only on the count,
// so a rebuilt list of the same length doesn't restart it.
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
