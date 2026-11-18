<script lang="ts">
  import { resolveConfig } from './config';
  import { buildBoard } from './lib/board/build';
  import AlertStrip from './lib/components/AlertStrip.svelte';
  import BikesPanel from './lib/components/BikesPanel.svelte';
  import Header from './lib/components/Header.svelte';
  import Panel from './lib/components/Panel.svelte';
  import { paletteFor } from './lib/palette';
  import { createPoller } from './lib/poller.svelte';
  import { serviceDate } from './lib/time';
  import type { PanelId } from './lib/types';

  const cfg = resolveConfig(location.search);
  const poller = createPoller(cfg);
  const data = poller.state;

  // Chosen once per page load; the board reloads daily at 04:00, which moves a rotating palette on.
  const palette = paletteFor(cfg.palette, serviceDate(Date.now()));
  document.documentElement.style.setProperty('--frame', palette.frame);
  document.documentElement.style.setProperty('--on-frame', palette.onFrame);

  $effect(() => {
    poller.start();
    return () => poller.stop();
  });

  // The one-column portrait layout only pays off on screens clearly taller than wide; a square
  // screen stacked four panels too short to hold a row. The result goes on <html data-layout>,
  // which the header's styles read too, so the two can't disagree.
  const portraitQuery = matchMedia('(max-aspect-ratio: 5/6)');
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
          live: data.live,
          scheduled: data.scheduled,
          health: data.health,
          alerts: data.alerts,
          hide: cfg.hide,
          extraRoutes: data.extraRoutes,
        })
      : undefined,
  );

  // Landscape: Red Line over Bluebikes beside Buses over MIT shuttles. Portrait: one column.
  const LANDSCAPE: PanelId[][] = [['subway', 'bikes'], ['bus', 'shuttle']];
  const PORTRAIT: PanelId[][] = [['subway', 'bus', 'shuttle', 'bikes']];

  const columns = $derived.by(() => {
    const byId = new Map(board?.panels.map((p) => [p.id, p]) ?? []);
    return (landscape ? LANDSCAPE : PORTRAIT)
      .map((ids) => ids.flatMap((id) => byId.get(id) ?? []))
      .filter((col) => col.length > 0);
  });

  /**
   * Each panel's share of its column. Fixed, so panel borders don't move as departures come
   * and go (sizing from each poll's rows made panels jump and re-trim every few seconds).
   */
  const SHARE: Record<PanelId, number> = { subway: 3, bus: 2, shuttle: 1.6, bikes: 1.6 };
</script>

<div class="screen">
  <Header name={cfg.name} place={cfg.place} now={data.now} />

  <main>
    {#if !board}
      <p class="message">Finding nearby transit…</p>
    {:else if columns.length === 0}
      <p class="message">No departures nearby in the next hour.</p>
    {:else}
      {#each columns as col, ci (ci)}
        <div class="column">
          {#each col as panel (panel.id)}
            <div class="slot" style:flex-grow={SHARE[panel.id]}>
              {#if panel.id === 'bikes'}
                <Panel {panel}>
                  {#snippet children(maxRows)}
                    <BikesPanel stations={data.bikes.slice(0, maxRows)} />
                  {/snippet}
                </Panel>
              {:else}
                <Panel {panel} />
              {/if}
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
  /*
   * SA+P's L-frame: the frame color shows as the header band, a rail down the right edge,
   * and the rails between panels (the screen's background showing through the gaps).
   */
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
  }
  .column {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--rail-w);
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
    background: var(--page);
    font-family: var(--font-serif);
    font-size: 1.3em;
    color: var(--muted);
  }
  .legend {
    margin: 0;
    padding: 0.5vmin 2.2vmin 0.8vmin;
    background: var(--page);
    border-top: var(--rail-w) solid var(--frame);
    font-family: var(--font-serif);
    font-size: 0.75em;
    font-style: italic;
    color: var(--muted);
  }
</style>
