<script lang="ts">
  import './board.css';
  import { untrack } from 'svelte';
  import { dev } from '$app/env';
  import { updated } from '$app/state';
  import { buildBoard } from '#lib/board/build.ts';
  import { PANELS, panelToHide } from '#lib/board/panels.ts';
  import { panelNeed, panelRows, priorityFactor, splitColumn, uncappedPanel, type ColumnItem } from '#lib/board/size.ts';
  import { measure, type ColumnSize } from '#lib/ui/measure.ts';
  import AlertStrip from '#lib/ui/AlertStrip.svelte';
  import Header from '#lib/ui/Header.svelte';
  import Panel from '#lib/ui/Panel.svelte';
  import { createDemoPoller } from '#lib/data/demo.svelte.ts';
  import { paletteFor } from '#lib/ui/palette.ts';
  import { createPoller } from '#lib/data/poller.svelte.ts';
  import { serviceDate } from '#lib/util/time.ts';
  import type { BoardPanel, PanelId } from '#lib/types.ts';
  import type { PageProps } from './$types';

  let props: PageProps = $props();
  // Set up once per page load: the board has no links, and the daily reload starts it fresh.
  const cfg = untrack(() => props.data.cfg);
  /** Demo mode exists only on the dev server: `dev` is a build-time constant, so builds leave the sample data out. */
  const demo = dev ? untrack(() => props.data.demo) : null;
  const poller = dev && demo !== null ? createDemoPoller(demo) : createPoller(cfg);
  const data = poller.state;

  // A new deploy reaches the screen within the hour (SvelteKit checks hourly), not at the next 04:00 reload.
  $effect(() => {
    if (updated.current) location.reload();
  });

  /** Picked once per load; the daily 04:00 reload moves a rotating palette on. */
  const palette = paletteFor(cfg.palette, serviceDate(Date.now()));
  const root = document.documentElement;
  root.style.setProperty('--frame', palette.frame);
  root.style.setProperty('--on-frame', palette.onFrame);
  root.style.setProperty('--rail', palette.rail);
  root.style.setProperty('--inset', `${cfg.inset}vmin`);
  root.dataset.brand = palette.brand;

  $effect(() => {
    poller.start();
    return () => poller.stop();
  });

  // Hide the pointer on the wall display, but only once it sits still, so a laptop viewer keeps it.
  $effect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      delete root.dataset.idle;
      clearTimeout(timer);
      timer = setTimeout(() => (root.dataset.idle = ''), 3_000);
    };
    wake();
    addEventListener('pointermove', wake);
    return () => {
      clearTimeout(timer);
      removeEventListener('pointermove', wake);
    };
  });

  /**
   * One column on screens clearly taller than wide, or too narrow for two columns of 16 px type
   * (36 type-widths, as board.css caps it). The header reads the same `<html data-layout>`.
   */
  const portraitQuery = matchMedia('(max-aspect-ratio: 5/6), (max-width: 575px)');
  let landscape = $state(!portraitQuery.matches);
  $effect(() => {
    const update = () => (landscape = !portraitQuery.matches);
    portraitQuery.addEventListener('change', update);
    return () => portraitQuery.removeEventListener('change', update);
  });
  $effect(() => {
    document.documentElement.dataset.layout = landscape ? 'landscape' : 'portrait';
  });

  const board = $derived(
    data.discovered
      ? buildBoard({
          discovered: data.discovered,
          nowMs: data.now,
          feeds: cfg.feeds,
          live: data.live,
          scheduled: data.scheduled,
          health: data.health,
          alerts: data.alerts,
          stations: data.stations,
          hide: cfg.hide,
          extraRoutes: data.extraRoutes,
        })
      : undefined,
  );

  /**
   * Panels left out because a column is too short for its panels' one-row floors: the lowest
   * priority (cfg.priority) in that column goes first, one at a time, until the rest fit.
   */
  let hidden = $state<PanelId[]>([]);
  const panelIds = $derived((board?.panels ?? []).map((p) => p.id).join());
  /** Starts over, so more room shows everything again; runs when the screen, the panels or their rows change. */
  const reset = () => {
    hidden = [];
  };
  $effect(() => {
    void panelIds;
    void landscape;
    void rowsKey;
    reset();
  });
  $effect(() => {
    addEventListener('resize', reset);
    return () => removeEventListener('resize', reset);
  });
  $effect(() => {
    const next = panelToHide(columns.map((col) => col.map((x) => x.panel.id)), overflowing, cfg.priority);
    if (next) hidden = [...hidden, next];
  });
  const listFormat = new Intl.ListFormat('en', { type: 'conjunction' });
  const hiddenNote = $derived.by(() => {
    const titles = (board?.panels ?? []).filter((p) => hidden.includes(p.id)).map((p) => p.title);
    return titles.length > 0 ? `${listFormat.format(titles)} hidden: screen too short.` : '';
  });

  /** The rows each panel starts at in its column: those its service could show today (src/lib/board/size.ts). */
  const rows = $derived.by(() => {
    const out = new Map<PanelId, number>();
    for (const def of PANELS) {
      const panel = board?.panels.find((p) => p.id === def.id);
      if (!panel) continue;
      /** Nothing to list (only "live data unavailable"), so the panel keeps just its notes. */
      const empty = !panel.stations && panel.groups.every((g) => g.rows.length === 0);
      const need = data.discovered && panelNeed(def, data.discovered, data.service, cfg.hide);
      out.set(def.id, panelRows(def, need, empty));
    }
    return out;
  });
  /** Read by the reset, so it covers hidden panels too: hiding one must not start the hiding over. */
  const rowsKey = $derived([...rows].join());
  /** Each panel's height at its starting rows, as it reports through `bind:startHeight`. */
  let startHeights = $state<Partial<Record<PanelId, number>>>({});
  /** Each panel's least height, as it reports through `bind:floorHeight`. */
  let floorHeights = $state<Partial<Record<PanelId, number>>>({});
  /** Each column's height and the gap between its panels, in px, as it reports through `use:measure`. */
  let columnSizes = $state<ColumnSize[]>([]);
  /**
   * Landscape: each panel in its PANELS column. Portrait: one column in PANELS order. Each panel starts
   * at its rows; spare room goes to the column's top-priority panel, and a short column shrinks lower ones more.
   */
  const columns = $derived.by(() => {
    const cols = new Map<number, { panel: BoardPanel; rows: number; grow: number; shrink: number }[]>();
    for (const def of PANELS) {
      const panel = board?.panels.find((p) => p.id === def.id);
      if (!panel || hidden.includes(def.id)) continue;
      const c = landscape ? def.column : 0;
      const shrink = 1 / priorityFactor(def.id, cfg.priority);
      cols.set(c, [...(cols.get(c) ?? []), { panel, rows: rows.get(def.id)!, grow: 0, shrink }]);
    }
    return [...cols.entries()].sort(([a], [b]) => a - b).map(([, col]) => {
      const ids = col.map((x) => x.panel.id);
      const top = uncappedPanel(ids, cfg.priority, col.filter((x) => x.rows === 0).map((x) => x.panel.id));
      return col.map((x) => (x.panel.id === top ? { ...x, grow: 1 } : x));
    });
  });
  /**
   * Each column's panel heights in px (splitColumn), or null when the floors don't fit. Undefined
   * until the column and its panels have been measured; the slots then share the column evenly.
   */
  const heights = $derived(columns.map((col, ci) => {
    const size = columnSizes[ci];
    const items = col.map((x) => ({
      start: startHeights[x.panel.id], floor: floorHeights[x.panel.id], shrink: x.shrink, grow: x.grow,
    }));
    if (!size || items.some((i) => i.start === undefined || i.floor === undefined)) return undefined;
    return splitColumn(size.height, size.gap, items as ColumnItem[]);
  }));
  /** Indexes of the columns too short for their panels' floors. */
  const overflowing = $derived(new Set(heights.flatMap((h, ci) => (h === null ? [ci] : []))));
</script>

<svelte:head><title>{[cfg.building, cfg.name || data.name].filter(Boolean).join(' ')} transit screen</title></svelte:head>

<div class="screen">
  <Header building={cfg.building} name={cfg.name || data.name || ''} now={data.now} tag={demo !== null ? 'Sample data' : undefined} />

  <main>
    {#if !board && data.unknownBuilding}
      <!-- Only whoever set up the screen sees this, so it says how to fix it. -->
      <p class="message">Building {cfg.building} isn't on the MIT campus map. Check the number, or add its lat and lon to the URL.</p>
    {:else if !board && data.discoveryFailures > 0}
      <p class="message">Can't reach the transit data service. Trying again every minute.</p>
    {:else if !board}
      <p class="message">Finding nearby transit…</p>
    {:else if columns.length === 0}
      <p class="message">No departures nearby in the next hour.</p>
    {:else}
      {#each columns as col, ci (ci)}
        <div class="column" use:measure={(size) => (columnSizes[ci] = size)}>
          {#each col as { panel, rows }, pi (panel.id)}
            {@const h = heights[ci]?.[pi]}
            <div class="slot" style:height={h === undefined ? undefined : `${h}px`} style:flex={h === undefined ? undefined : 'none'}>
              <Panel {panel} {rows} bind:startHeight={startHeights[panel.id]} bind:floorHeight={floorHeights[panel.id]} />
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </main>

  {#if board}<AlertStrip alerts={board.alerts} />{/if}
  <!-- Always shown: toggling it would resize every panel. -->
  {#if board}
    <p class="legend">
      Times in italics are scheduled. Others are live.{#if hiddenNote}{' '}<span class="hidden-note">{hiddenNote}</span>{/if}
    </p>
  {/if}
</div>

<style>
  /* SA+P's L-frame: header band and right edge in the frame color; dark rails between panels. */
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-right: calc(var(--rail-w) * 2);
    background: var(--frame);
  }
  main {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: var(--rail-w);
    background: var(--rail);
  }
  .column {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--rail-w);
    background: var(--rail);
    overflow: hidden;
  }
  /* Shares the column evenly until measured, then gets its height from splitColumn inline. */
  .slot {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
  }
  .message {
    margin: 0;
    flex: 1;
    display: grid;
    place-items: center;
    padding: 0 2.2vmin;
    background: var(--page);
    text-align: center;
    font-family: var(--font-accent);
    font-size: 1.3em;
    color: var(--muted);
  }
  .legend {
    margin: 0;
    padding: 0.5vmin 2.2vmin 0.8vmin;
    background: var(--page);
    border-top: var(--rail-w) solid var(--rail);
    font-family: var(--font-accent);
    font-size: 0.75em;
    font-style: italic;
    color: var(--muted);
  }
  /* Says which panels a short screen left out, so a missing panel isn't read as no service. */
  .hidden-note {
    font-family: var(--font-sans);
    font-style: normal;
    font-weight: 700;
    color: var(--emphasis);
  }
</style>
