import type { BoardPanel } from '../types';

/** Which marks the board's rows carry (cut rows included), so the line at the bottom explains only those. */
export function marksShown(panels: readonly BoardPanel[]): { scheduled: boolean; missable: boolean } {
  const times = panels.flatMap((p) => p.groups.flatMap((g) => g.rows.flatMap((r) => r.times)));
  return { scheduled: times.some((t) => !t.live), missable: times.some((t) => t.missable === true) };
}
