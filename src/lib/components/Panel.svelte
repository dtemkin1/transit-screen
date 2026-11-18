<script lang="ts">
  import type { Snippet } from 'svelte';
  import { trimPanel } from '../board/trim';
  import type { BoardPanel } from '../types';
  import Row from './Row.svelte';

  /** `children` replaces the rows (bikes); it gets how many lines fit. */
  let { panel, children }: { panel: BoardPanel; children?: Snippet<[number]> } = $props();

  let body: HTMLElement | undefined = $state();
  let bodyHeight = $state(0);
  // Kept from the last measurement, so a body too small for any line stays empty instead of flickering.
  let lineHeight = $state(0);

  const maxLines = $derived(lineHeight > 0 ? Math.floor(bodyHeight / lineHeight) : Infinity);
  const shown = $derived(trimPanel(panel, maxLines));
  const hasRows = $derived(panel.groups.some((g) => g.rows.length > 0));
  const unavailable = $derived(panel.status === 'unavailable' && !hasRows);

  function measure() {
    if (!body) return;
    bodyHeight = body.clientHeight;
    const line = body.querySelector<HTMLElement>('.line');
    if (line) {
      const h = line.getBoundingClientRect().height;
      if (h > 0) lineHeight = h;
    }
  }

  $effect(() => {
    if (!body) return;
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    return () => ro.disconnect();
  });

  // Re-measure once new content is in the DOM (the first line may only now exist).
  $effect(() => {
    void shown;
    void unavailable;
    measure();
  });
</script>

<section class="panel" data-panel={panel.id} aria-label={panel.title}>
  <h2 class="title">
    <span class="name">{panel.title}</span>
    {#if panel.status === 'delayed'}<span class="tag">data delayed</span>{/if}
  </h2>
  {#if panel.status === 'schedule-fallback'}
    <p class="note">Live data unavailable, showing schedule</p>
  {/if}
  <div class="body" bind:this={body}>
    {#if unavailable}
      <p class="note">Live data unavailable</p>
    {:else if children}
      {@render children(maxLines)}
    {:else}
      {#each shown.groups as group, gi (group.header?.name ?? gi)}
        {#if group.header}
          <div class="line station">
            <span class="station-name">{group.header.name}</span>
            <span class="walk">{group.header.walkEstimated ? '~' : ''}{group.header.walkMin} min walk</span>
          </div>
        {/if}
        {#each group.rows as row (row.key)}
          <Row {row} />
        {/each}
      {/each}
    {/if}
  </div>
</section>

<style>
  .panel {
    --line: 1.9em;
    background: var(--panel);
    border-radius: 0.8vmin;
    padding: 1.2vmin 1.4vmin;
    display: flex;
    flex-direction: column;
    gap: 0.4em;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .panel[data-panel='bus'],
  .panel[data-panel='shuttle'],
  .panel[data-panel='bikes'] {
    --line: 2.7em;
  }
  .title {
    margin: 0;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.6em;
    font-size: 0.8em;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tag {
    flex: none;
    padding: 0.1em 0.5em;
    border-radius: 0.3em;
    background: var(--alert-bg);
    color: var(--alert-text);
    letter-spacing: 0.02em;
    text-transform: none;
  }
  .note {
    margin: 0;
    color: var(--muted);
    font-size: 0.85em;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .station {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 0.6em;
    height: var(--line);
    padding-bottom: 0.2em;
    box-sizing: border-box;
    border-bottom: 1px solid var(--rule);
    font-weight: 600;
    color: var(--muted);
    white-space: nowrap;
  }
  /* Size the text, not the line: --line is in em and must match a row's height. */
  .station > span {
    font-size: 0.85em;
  }
  .station-name {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }
  .walk {
    flex: none;
  }
</style>
