import type { BoardGroup, BoardPanel, BoardRow } from '../types';

const lineCount = (groups: BoardGroup[]) =>
  groups.reduce((n, g) => n + (g.header ? 1 : 0) + g.rows.length, 0);

/** Drops rows left without times, then groups left without rows. */
const compact = (groups: BoardGroup[]): BoardGroup[] =>
  groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.times.length > 0) }))
    .filter((g) => g.rows.length > 0);

const nextReachable = (r: BoardRow) => r.times.find((t) => t.reachable)?.departureTime ?? Infinity;

/**
 * Cuts a panel down to at most `maxLines` lines (a group header or a row is one line)
 * by dropping whole rows: those with no reachable time first, then those whose next
 * reachable departure is furthest away. Groups left empty go with their headers.
 */
export function trimPanel(p: BoardPanel, maxLines: number): BoardPanel {
  if (lineCount(p.groups) <= maxLines) return p;
  let groups = compact(p.groups);
  while (lineCount(groups) > maxLines && groups.length > 0) {
    // Last row wins ties, so earlier rows are kept.
    let drop = { g: 0, r: 0, t: -Infinity };
    for (const [gi, g] of groups.entries()) {
      for (const [ri, r] of g.rows.entries()) {
        const t = nextReachable(r);
        if (t >= drop.t) drop = { g: gi, r: ri, t };
      }
    }
    groups = compact(groups.map((grp, gi) =>
      gi === drop.g ? { ...grp, rows: grp.rows.filter((_, ri) => ri !== drop.r) } : grp));
  }
  return { ...p, groups };
}
