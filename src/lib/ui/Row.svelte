<script lang="ts">
  import { fit, type Segment } from './fit';
  import { abbreviate, routeBadge, splitVia } from './format';
  import type { BoardRow } from '../types';

  let { row }: { row: BoardRow } = $props();

  const MINUTES = /^(\d+) min$/;

  const colors = $derived(routeBadge(row.route));
  const next = $derived(row.times[0]);
  const nextMin = $derived(next ? MINUTES.exec(next.label)?.[1] : undefined);
  const later = $derived(row.times.slice(1));
  /** "then 17, 31 min": the unit once, after the last time, when every later time is in minutes. */
  const laterText = $derived.by(() => {
    const nums = later.map((t) => MINUTES.exec(t.label)?.[1]);
    return nums.every((n) => n !== undefined) ? `${nums.join(', ')} min` : later.map((t) => t.label).join(', ');
  });
  const stop = $derived(row.stopName !== undefined ? abbreviate(row.stopName) : '');
  const walk = $derived(row.stopName !== undefined ? `${row.walkEstimated ? '~' : ''}${row.walkMin} min walk` : '');
  const headsign = $derived(abbreviate(row.headsign));
  /** The destination and its " via …" part, set lighter, so a cut row loses that first. */
  const parts = $derived(splitVia(headsign));
  const destination = $derived<Segment[]>([{ text: parts.dest }, ...(parts.via ? [{ text: parts.via, cls: 'toward' }] : [])]);
  /** Named routes ("Tech Shuttle") lead with the name; everything else leads with the destination. */
  const routeName = $derived(row.route.named ? row.route.longName || row.route.shortName : '');
  /** When the name and destination don't both fit, the destination shows alone (the badge names the route). */
  const title = $derived<Segment[][]>(
    !routeName ? [destination]
    : row.headsign && row.headsign !== routeName ? [[{ text: routeName }, { text: ` to ${headsign}`, cls: 'toward' }], destination]
    : [[{ text: routeName }]],
  );
  /** The walk time ("2 min walk") is never split; the stop name gives way first, then the status. */
  const sub = $derived<Segment[]>([
    ...(next?.status ? [{ text: next.status, cls: 'status' }] : []),
    ...(next?.status && stop ? [{ text: '. ' }] : []),
    ...(stop ? [{ text: stop }] : []),
    ...(walk ? [{ text: stop ? `, ${walk}` : walk, keep: true }] : []),
  ]);
</script>

<div class="row">
  <span class="badge" class:long={colors.text.length > 3} style:background={colors.bg} style:color={colors.fg}>{colors.text}</span>
  <div class="dest">
    <span class="headsign" use:fit={title}></span>
    {#if sub.length > 0}<span class="sub" use:fit={sub}></span>{/if}
  </div>
  {#if next}
    <div class="times">
      <!-- A time that may be missed only ever shows alone (build.ts), so only the first is checked. -->
      <span class="next" class:scheduled={!next.live} class:missable={next.missable}>
        {#if nextMin !== undefined}{nextMin}<small> min</small>{:else}{next.label}{/if}{#if next.missable}<span
            class="mark" aria-hidden="true">*</span><span class="visually-hidden"> (may leave before you can walk there)</span>{/if}
      </span>
      {#if later.length > 0}
        <span class="later" class:scheduled={later.some((t) => !t.live)}>then {laterText}</span>
      {/if}
    </div>
  {:else if row.note}
    <span class="note">{row.note}</span>
  {/if}
</div>

<style>
  .row {
    height: var(--row);
    display: grid;
    /* Fixed badge column, so destinations line up. */
    grid-template-columns: 2.7em minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 0.55em;
    border-top: 1px solid var(--rule);
  }
  /* A full pill, bold, as MBTA's own departure screens draw routes (mbta/screens route_pill.scss). */
  .badge {
    padding: 0.12em 0;
    border-radius: 999px;
    font-weight: 700;
    text-align: center;
    white-space: nowrap;
    letter-spacing: -0.02em;
  }
  /* Over three characters ("BDv2") is set smaller, as MBTA's route pills do, so it clears the round ends. */
  .badge.long {
    font-size: 0.8em;
    line-height: 1.5;
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
  /* Filled and cut at a word boundary by `fit`, which adds the "…". */
  .headsign,
  .sub {
    white-space: nowrap;
    overflow: hidden;
  }
  .headsign {
    font-weight: 700;
  }
  .headsign :global(.toward) {
    font-weight: 400;
  }
  .sub,
  .later {
    font-size: 0.76em;
    color: var(--muted);
    white-space: nowrap;
  }
  .sub :global(.status) {
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
  /* A train that leaves before the walk is done: quieter than the times one can catch, and starred. */
  .missable {
    color: var(--muted);
  }
  .mark {
    margin-left: 0.05em;
  }
  .note {
    font-size: 0.76em;
    color: var(--muted);
    white-space: nowrap;
  }
</style>
