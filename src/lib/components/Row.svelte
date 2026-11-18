<script lang="ts">
  import type { BoardRow, RouteInfo, TimeCell } from '../types';

  let { row }: { row: BoardRow } = $props();

  const HEX = /^#[0-9a-f]{6}$/i;
  const MINUTES = /^(\d+) min$/;

  /** Short names up to 4 characters fit a pill as is; longer ones ("Red Line", "Tech Shuttle") become initials. */
  function pillText(r: RouteInfo): string {
    const name = r.shortName || r.longName;
    if (name.length <= 4) return name;
    return name.split(/[\s/-]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  }

  /** "4, 15, 22 min": the unit is written once, after the last time, when that time is in minutes. */
  function cellText(cells: TimeCell[]): { cell: TimeCell; text: string }[] {
    const lastIsMin = MINUTES.test(cells[cells.length - 1]?.label ?? '');
    return cells.map((cell, i) => {
      const m = MINUTES.exec(cell.label);
      const last = i === cells.length - 1;
      return { cell, text: m && lastIsMin && !last ? m[1] : cell.label };
    });
  }

  const bg = $derived(HEX.test(row.route.color) ? row.route.color : '#5f6368');
  const fg = $derived(HEX.test(row.route.textColor) ? row.route.textColor : '#ffffff');
  const times = $derived(cellText(row.times));
</script>

<div class="line row" class:sub={row.stopName !== undefined}>
  <span class="pill" style:background={bg} style:color={fg}>{pillText(row.route)}</span>
  <span class="dest">
    <span class="headsign">{row.headsign}</span>
    {#if row.stopName !== undefined}
      <span class="stop">{row.stopName} · {row.walkEstimated ? '~' : ''}{row.walkMin} min walk</span>
    {/if}
  </span>
  <span class="times">
    {#each times as { cell, text }, i (cell.departureTime)}
      {#if i > 0}<span class="sep">,</span>{/if}<span
        class="t"
        class:scheduled={!cell.live}
        class:unreachable={!cell.reachable}>{text}</span>
    {/each}
  </span>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 0.6em;
    height: var(--line);
    min-width: 0;
  }
  .pill {
    flex: none;
    min-width: 2.4em;
    padding: 0.1em 0.35em;
    border-radius: 0.25em;
    font-weight: 700;
    font-size: 0.9em;
    text-align: center;
    white-space: nowrap;
  }
  .dest {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }
  .headsign,
  .stop {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stop {
    color: var(--muted);
    font-size: 0.75em;
  }
  .times {
    flex: none;
    white-space: nowrap;
  }
  .t {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .sep {
    margin-right: 0.3em;
    color: var(--muted);
  }
  .scheduled {
    color: var(--muted);
    font-style: italic;
  }
  .unreachable {
    opacity: 0.35;
  }
</style>
