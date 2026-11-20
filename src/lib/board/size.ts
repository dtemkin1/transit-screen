import type { Discovered } from '../data/discovery';
import type { PanelDef } from './panels';
import type { BoardPanel, PanelId, ServiceRow, Source } from '../types';

/** Row height, in the panel's em. */
export const ROW_EM = 2.5;
/** Station header height, also in the panel's em. */
export const HEADER_EM = 1.45;

/** An "unavailable" note's height in the panel's em: its 0.4em top margin plus one 1.2em line. */
const NOTE_EM = 1.6;
/** Space under the last note, matching the margin above each. */
const NOTE_END_EM = 0.4;
const PRIORITY_STEP = 1.25;
const FALLBACK_ROWS_PER_SHARE = 3;

/**
 * Rows the panel could show today, from each feed's daily service list, so its height doesn't follow
 * departures in and out of the hour. Undefined while a feed with stops in the panel hasn't reported.
 */
export function panelNeed(
  def: PanelDef, discovered: Pick<Discovered, 'stops' | 'stations'>, service: Partial<Record<Source, ServiceRow[]>>,
  hide: readonly string[] = [],
): number | undefined {
  if (def.rows === 'stations') return discovered.stations.filter((s) => s.mode === def.id).length;
  const sources = [...new Set(discovered.stops.filter((s) => s.mode === def.id).map((s) => s.source))];
  if (sources.some((src) => !service[src])) return undefined;
  const shown = (src: Source, r: ServiceRow) =>
    r.mode === def.id && !hide.includes(r.routeId) && !hide.includes(`${src}:${r.routeId}`);
  const rows = sources.flatMap((src) => service[src]!.filter((r) => shown(src, r)).map((r) => ({ src, ...r })));
  if (def.rows === 'closest-stop') return new Set(rows.map((r) => `${r.src}:${r.key}`)).size;
  const stations = new Set(rows.map((r) => `${r.src}:${r.stopId}`)).size;
  return new Set(rows.map((r) => `${r.src}:${r.stopId}|${r.key}`)).size + stations * (HEADER_EM / ROW_EM);
}

/**
 * The least height the panel keeps, in rows: its `unavailableNotes` when it has nothing to list (pass 0
 * otherwise), else the first row, with its station header for the subway.
 */
export function panelFloor(panel: BoardPanel, unavailableNotes: number): number {
  if (unavailableNotes > 0) return (unavailableNotes * NOTE_EM + NOTE_END_EM) / ROW_EM;
  return panel.groups[0]?.header && !panel.stations ? 1 + HEADER_EM / ROW_EM : 1;
}

/**
 * The one panel in a column allowed past its need: the highest in `priority` with something to list
 * (not in `empty`). It takes the room the others can't fill, so the column never shows bare rail.
 */
export function uncappedPanel(
  column: readonly PanelId[], priority: readonly PanelId[], empty: readonly PanelId[] = [],
): PanelId {
  const ranked = [...priority.filter((id) => column.includes(id)), ...column.filter((id) => !priority.includes(id))];
  return ranked.find((id) => !empty.includes(id)) ?? ranked[0];
}

/**
 * The rows a panel starts at before its column grows or shrinks: its need, at least one row; 0 with
 * nothing to list, leaving just its notes (the panel never goes below its floor).
 */
export function panelRows(def: PanelDef, need: number | undefined, empty = false): number {
  if (empty) return 0;
  return need === undefined ? def.share * FALLBACK_ROWS_PER_SHARE : Math.max(need, 1);
}

export interface ColumnItem {
  /** Height at the panel's starting rows, px. */
  start: number;
  /** Least height, px. */
  floor: number;
  /** Share of a shortfall, per px of start: 1 / priorityFactor. */
  shrink: number;
  /** Share of spare room: 1 for the column's top panel, 0 for the rest. */
  grow: number;
}

/**
 * Panel heights in a column `height` px tall with `gap` between, or null when the floors don't fit. Like CSS
 * flex, which wouldn't shrink a panel below its start here: spare room by `grow`, a shortfall by start × `shrink`.
 */
export function splitColumn(height: number, gap: number, items: readonly ColumnItem[]): number[] | null {
  const room = height - gap * Math.max(items.length - 1, 0);
  if (items.reduce((n, i) => n + i.floor, 0) > room + 0.5) return null;
  const sizes = items.map((i) => i.start);
  const spare = room - sizes.reduce((n, s) => n + s, 0);
  if (spare >= 0) {
    const grow = items.reduce((n, i) => n + i.grow, 0);
    return grow === 0 ? sizes : sizes.map((s, k) => s + (spare * items[k].grow) / grow);
  }
  let short = -spare;
  const frozen = new Set<number>();
  while (short > 0.01) {
    const open = items.map((_, k) => k).filter((k) => !frozen.has(k));
    const weight = open.reduce((n, k) => n + items[k].start * items[k].shrink, 0);
    if (weight === 0) break;
    let taken = 0;
    for (const k of open) {
      const want = (short * items[k].start * items[k].shrink) / weight;
      const give = Math.min(want, sizes[k] - items[k].floor);
      sizes[k] -= give;
      taken += give;
      if (give < want) frozen.add(k);
    }
    short -= taken;
  }
  return sizes;
}

/** 1.25 per step the panel sits above the last in `priority`: on a short screen, a higher one gives up less. */
export function priorityFactor(id: PanelId, priority: readonly PanelId[]): number {
  const rank = priority.indexOf(id);
  return PRIORITY_STEP ** (rank === -1 ? 0 : priority.length - 1 - rank);
}
