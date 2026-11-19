import type { BoardGroup, BoardPanel, BoardRow } from '../types';

const lineCount = (groups: BoardGroup[], headerWeight: number) =>
  groups.reduce((n, g) => n + (g.header ? headerWeight : 0) + g.rows.length, 0);

/** Drops rows left without times, then groups left without rows. */
const compact = (groups: BoardGroup[]): BoardGroup[] =>
  groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.times.length > 0) }))
    .filter((g) => g.rows.length > 0);

const nextDeparture = (r: BoardRow) => r.times[0]?.departureTime ?? Infinity;

// Fits a panel to `maxLines` (a header counts `headerWeight`) by dropping whole rows,
// furthest next departure first; emptied groups go with their headers.
export function trimPanel(p: BoardPanel, maxLines: number, headerWeight = 1): BoardPanel {
  if (lineCount(p.groups, headerWeight) <= maxLines) return p;
  let groups = compact(p.groups);
  while (lineCount(groups, headerWeight) > maxLines && groups.length > 0) {
    // Last row wins ties, so earlier rows are kept.
    let drop = { g: 0, r: 0, t: -Infinity };
    for (const [gi, g] of groups.entries()) {
      for (const [ri, r] of g.rows.entries()) {
        const t = nextDeparture(r);
        if (t >= drop.t) drop = { g: gi, r: ri, t };
      }
    }
    groups = compact(groups.map((grp, gi) =>
      gi === drop.g ? { ...grp, rows: grp.rows.filter((_, ri) => ri !== drop.r) } : grp));
  }
  return { ...p, groups };
}
