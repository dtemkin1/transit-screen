import type { PanelId } from '../types';

export interface PanelDef {
  id: PanelId;
  title: string;
  /** Use the name of the one route ("Red Line") or feed ("Bluebikes") shown, when there is just one. */
  nameBy?: 'route' | 'feed';
  rows: 'by-station' | 'closest-stop' | 'stations';
  /** 'route': closest-stop rows in route order, so a rider finds a route in the same place; else soonest first. */
  order?: 'route';
  /** Relative height used, at 3 rows each, while the panel's need is unknown. */
  share: number;
  /** Landscape column; portrait stacks panels in this table's order. */
  column: number;
}

export const PANELS: readonly PanelDef[] = [
  { id: 'subway', title: 'Subway', nameBy: 'route', rows: 'by-station', share: 3, column: 0 },
  { id: 'bus', title: 'Buses', rows: 'closest-stop', order: 'route', share: 2, column: 1 },
  { id: 'shuttle', title: 'Shuttles', nameBy: 'feed', rows: 'closest-stop', share: 1.6, column: 1 },
  { id: 'bikes', title: 'Bikes', nameBy: 'feed', rows: 'stations', share: 1.6, column: 0 },
];

/**
 * The next panel to hide when columns (by index in `overflowing`) are too short for their panels'
 * one-row floors: the one last in `priority` among them. Never a column's only panel.
 */
export function panelToHide(
  columns: readonly (readonly PanelId[])[], overflowing: ReadonlySet<number>, priority: readonly PanelId[],
): PanelId | undefined {
  const candidates = columns.filter((col, i) => overflowing.has(i) && col.length > 1).flat();
  const ranked = [...priority, ...candidates.filter((id) => !priority.includes(id))];
  return ranked.reverse().find((id) => candidates.includes(id));
}
