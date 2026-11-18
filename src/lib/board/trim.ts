import type { BoardGroup, BoardPanel, BoardRow } from '../types';

const lineCount = (groups: BoardGroup[]) =>
  groups.reduce((n, g) => n + (g.header ? 1 : 0) + g.rows.length, 0);

/** Drops rows left without times, then groups left without rows. */
const compact = (groups: BoardGroup[]): BoardGroup[] =>
  groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.times.length > 0) }))
    .filter((g) => g.rows.length > 0);

const mapRows = (groups: BoardGroup[], f: (r: BoardRow) => BoardRow): BoardGroup[] =>
  compact(groups.map((g) => ({ ...g, rows: g.rows.map(f) })));

/** Cuts a panel down to at most `maxLines` lines (a group header or a row is one line). */
export function trimPanel(p: BoardPanel, maxLines: number): BoardPanel {
  let groups = p.groups;
  const fits = () => lineCount(groups) <= maxLines;

  if (!fits()) groups = mapRows(groups, (r) => ({ ...r, times: r.times.filter((t) => t.reachable) }));
  for (const n of [2, 1]) {
    if (!fits()) groups = mapRows(groups, (r) => ({ ...r, times: r.times.slice(0, n) }));
  }
  while (!fits() && groups.length > 0) {
    // Drop the row whose first time is latest (the last such row on ties).
    let drop = { g: 0, r: 0, t: -Infinity };
    for (const [gi, g] of groups.entries()) {
      for (const [ri, r] of g.rows.entries()) {
        const t = r.times[0].departureTime;
        if (t >= drop.t) drop = { g: gi, r: ri, t };
      }
    }
    groups = compact(groups.map((grp, gi) =>
      gi === drop.g ? { ...grp, rows: grp.rows.filter((_, ri) => ri !== drop.r) } : grp));
  }
  return groups === p.groups ? p : { ...p, groups };
}
