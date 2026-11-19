<script lang="ts">
  import { resolveConfig } from './config';
  import { buildBoard } from './lib/board/build';
  import { PANELS } from './lib/board/panels';
  import AlertStrip from './lib/ui/AlertStrip.svelte';
  import Header from './lib/ui/Header.svelte';
  import Panel from './lib/ui/Panel.svelte';
  import { createDemoPoller } from './lib/data/demo.svelte';
  import { paletteFor } from './lib/ui/palette';
  import { createPoller } from './lib/data/poller.svelte';
  import { serviceDate } from './lib/util/time';
  import type { BoardPanel } from './lib/types';

  const cfg = resolveConfig(location.search);
  // `?demo` on the dev server shows sample data covering every state (src/lib/data/demo.svelte.ts).
  const demo = import.meta.env.DEV ? new URLSearchParams(location.search).get('demo') : null;
  const poller = demo !== null ? createDemoPoller(demo) : createPoller(cfg);
  const data = poller.state;

  // Picked once per load; the daily 04:00 reload moves a rotating palette on.
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

  // One column on screens clearly taller than wide, or too narrow for two columns of 16 px type
  // (36 type-widths, as app.css caps it); the header reads the same <html data-layout>.
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

  const EMPTY_SHARE = 1; // room for the title and a note or two

  // Landscape: each panel in its PANELS column. Portrait: one column in PANELS order.
  const columns = $derived.by(() => {
    const cols = new Map<number, { panel: BoardPanel; share: number }[]>();
    for (const def of PANELS) {
      const panel = board?.panels.find((p) => p.id === def.id);
      if (!panel) continue;
      const c = landscape ? def.column : 0;
      // A panel with nothing to list (only "live data unavailable") gives its room to the others.
      const empty = !panel.stations && panel.groups.every((g) => g.rows.length === 0);
      cols.set(c, [...(cols.get(c) ?? []), { panel, share: empty ? EMPTY_SHARE : def.share }]);
    }
    return [...cols.entries()].sort(([a], [b]) => a - b).map(([, col]) => col);
  });
</script>

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
        <div class="column">
          {#each col as { panel, share } (panel.id)}
            <div class="slot" style:flex-grow={share}>
              <Panel {panel} />
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </main>

  {#if board}<AlertStrip alerts={board.alerts} />{/if}
  <!-- Always shown: toggling it would resize every panel. -->
  {#if board}<p class="legend">Times in italics are scheduled. Others are live.</p>{/if}
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
  }
  .slot {
    flex-basis: 0;
    min-height: 0;
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
</style>
