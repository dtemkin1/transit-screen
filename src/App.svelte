<script lang="ts">
  import { resolveConfig } from './config';
  import { buildBoard } from './lib/board/build';
  import AlertStrip from './lib/components/AlertStrip.svelte';
  import BikesPanel from './lib/components/BikesPanel.svelte';
  import Header from './lib/components/Header.svelte';
  import Panel from './lib/components/Panel.svelte';
  import { createPoller } from './lib/poller.svelte';
  import type { PanelId } from './lib/types';

  const cfg = resolveConfig(location.search);
  const poller = createPoller(cfg);
  const data = poller.state;

  $effect(() => {
    poller.start();
    return () => poller.stop();
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

  // Track widths (landscape) and row heights (portrait) for the panels present, so missing ones collapse.
  const WIDTH: Record<PanelId, string> = { subway: '1.2fr', bus: '1fr', shuttle: '1fr', bikes: '.8fr' };
  const ids = $derived(new Set(board?.panels.map((p) => p.id) ?? []));
  const cols = $derived([...ids].map((id) => `minmax(0, ${WIDTH[id]})`).join(' '));
  const rows = $derived(
    [
      ids.has('subway') && 'minmax(0, 1.25fr)',
      ids.has('bus') && 'minmax(0, 1fr)',
      (ids.has('shuttle') || ids.has('bikes')) && 'minmax(0, .8fr)',
    ].filter(Boolean).join(' '),
  );
  // In portrait, shuttle and bikes share a row; one alone takes the full width.
  const pairedBottom = $derived(ids.has('shuttle') && ids.has('bikes'));
</script>

<div class="screen">
  <Header name={cfg.name} now={data.now} />

  <main>
    {#if !board}
      <p class="message">Finding nearby transit…</p>
    {:else if board.panels.length === 0}
      <p class="message">No departures nearby in the next hour.</p>
    {:else}
      <div class="grid" style:--cols={cols} style:--rows={rows}>
        {#each board.panels as panel (panel.id)}
          <div class="cell" data-panel={panel.id} class:wide={!pairedBottom}>
            {#if panel.id === 'bikes'}
              <Panel {panel}>
                {#snippet children(maxLines)}
                  <BikesPanel stations={data.bikes.slice(0, maxLines)} />
                {/snippet}
              </Panel>
            {:else}
              <Panel {panel} />
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </main>

  {#if board}<AlertStrip alerts={board.alerts} />{/if}
</div>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 1.2vmin;
    padding: 1.6vmin 2vmin;
  }
  main {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .message {
    margin: auto;
    color: var(--muted);
    font-size: 1.4em;
  }
  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    gap: 1.2vmin;
  }
  .cell {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .cell > :global(*) {
    flex: 1;
  }

  /* Portrait: subway and buses full width, shuttles and bikes side by side. */
  .grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: var(--rows);
  }
  .cell[data-panel='subway'],
  .cell[data-panel='bus'],
  .cell.wide {
    grid-column: 1 / -1;
  }

  /* Landscape: one column per present panel. */
  @media (min-aspect-ratio: 1/1) {
    .grid {
      grid-template-columns: var(--cols);
      grid-template-rows: minmax(0, 1fr);
    }
    .cell[data-panel='subway'],
    .cell[data-panel='bus'],
    .cell.wide {
      grid-column: auto;
    }
  }
</style>
