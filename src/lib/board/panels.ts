import type { PanelId } from '../types';

export interface PanelDef {
  id: PanelId;
  title: string;
  /** Use the name of the one route ("Red Line") or feed ("Bluebikes") shown, when there is just one. */
  nameBy?: 'route' | 'feed';
  rows: 'by-station' | 'closest-stop' | 'stations';
  share: number;   // fixed height share, so panel borders stay put as departures come and go
  column: number;  // landscape column; portrait stacks panels in this table's order
}

export const PANELS: readonly PanelDef[] = [
  { id: 'subway', title: 'Subway', nameBy: 'route', rows: 'by-station', share: 3, column: 0 },
  { id: 'bus', title: 'Buses', rows: 'closest-stop', share: 2, column: 1 },
  { id: 'shuttle', title: 'Shuttles', nameBy: 'feed', rows: 'closest-stop', share: 1.6, column: 1 },
  { id: 'bikes', title: 'Bikes', nameBy: 'feed', rows: 'stations', share: 1.6, column: 0 },
];

/**
 * On a screen too short for every shown panel to fit a row (`fits[id] === false`), the next panel to
 * hide: the shown one last in `priority`. Never the only one left.
 */
export function panelToHide(
  shown: readonly PanelId[], fits: Partial<Record<PanelId, boolean>>, priority: readonly PanelId[],
): PanelId | undefined {
  if (shown.length < 2 || !shown.some((id) => fits[id] === false)) return undefined;
  const ranked = [...priority, ...shown.filter((id) => !priority.includes(id))];
  return ranked.reverse().find((id) => shown.includes(id));
}
