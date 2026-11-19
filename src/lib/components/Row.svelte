<script lang="ts">
  import { routeBadge, shortStopName } from '../display';
  import type { BoardRow } from '../types';

  let { row }: { row: BoardRow } = $props();

  const MINUTES = /^(\d+) min$/;

  const badge = $derived(routeBadge(row.route));
  const next = $derived(row.times[0]);
  const nextMin = $derived(next ? MINUTES.exec(next.label)?.[1] : undefined);
  const later = $derived(row.times.slice(1));
  // "then 17, 31 min": the unit once, after the last time, when every later time is in minutes.
  const laterText = $derived.by(() => {
    const nums = later.map((t) => MINUTES.exec(t.label)?.[1]);
    return nums.every((n) => n !== undefined) ? `${nums.join(', ')} min` : later.map((t) => t.label).join(', ');
  });
  const where = $derived(
    row.stopName !== undefined
      ? `${shortStopName(row.stopName)}, ${row.walkEstimated ? '~' : ''}${row.walkMin} min walk`
      : '',
  );
  // MIT shuttles are known by route ("Tech Shuttle"), and their loops' last stop says little on
  // its own, so they lead with the route name. Everything else leads with the destination.
  const routeName = $derived(row.route.source === 'mit' ? row.route.longName || row.route.shortName : '');
</script>

<div class="row">
  <span class="badge" style:background={badge.bg} style:color={badge.fg}>{badge.text}</span>
  <div class="dest">
    <span class="headsign">
      {#if routeName}{routeName}{#if row.headsign && row.headsign !== routeName}<span class="toward">{` to ${row.headsign}`}</span>{/if}{:else}{row.headsign}{/if}
    </span>
    {#if next?.status || where}
      <span class="sub">
        {#if next?.status}<span class="status">{next.status}</span>{/if}{#if next?.status && where}{'. '}{/if}{where}
      </span>
    {/if}
  </div>
  {#if next}
    <div class="times">
      <span class="next" class:scheduled={!next.live}>
        {#if nextMin !== undefined}{nextMin}<small> min</small>{:else}{next.label}{/if}
      </span>
      {#if later.length > 0}
        <span class="later" class:scheduled={later.some((t) => !t.live)}>then {laterText}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .row {
    height: var(--row);
    display: grid;
    /* A fixed badge column, so every destination starts at the same x. */
    grid-template-columns: 2.7em minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 0.55em;
    border-top: 1px solid var(--rule);
  }
  .badge {
    padding: 0.12em 0;
    font-weight: 700;
    text-align: center;
    white-space: nowrap;
    letter-spacing: -0.02em;
  }
  .dest,
  .times {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .times {
    align-items: flex-end;
  }
  .headsign,
  .sub {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .headsign {
    font-weight: 700;
  }
  .toward {
    font-weight: 400;
  }
  .sub,
  .later {
    font-size: 0.76em;
    color: var(--muted);
    white-space: nowrap;
  }
  .status {
    font-weight: 700;
    color: var(--emphasis);
  }
  .next {
    font-size: 1.3em;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }
  .next small {
    margin-left: 0.15em;
    font-size: 0.6em;
    font-weight: 400;
  }
  .scheduled {
    font-style: italic;
    color: var(--muted);
  }
</style>
