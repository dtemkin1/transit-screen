<script lang="ts">
  import { trimPanel } from '../board/trim';
  import type { BoardPanel } from '../types';
  import { fit } from './fit';
  import Row from './Row.svelte';
  import StationList from './StationList.svelte';

  let { panel, fits = $bindable() }: {
    panel: BoardPanel;
    /** Set by the panel: whether it has room to show anything useful, one row or its note. */
    fits?: boolean;
  } = $props();

  /** Row height, in the panel's em. */
  const ROW_EM = 2.5;
  /** Station header height, also in the panel's em, so the ratio passed to trimPanel is exact. */
  const HEADER_EM = 1.45;

  let body: HTMLElement | undefined = $state();
  let bodyHeight = $state(0);
  let emPx = $state(0);

  const rowPx = $derived(emPx * ROW_EM);
  const maxLines = $derived(rowPx > 0 ? bodyHeight / rowPx : Infinity);
  const shown = $derived(trimPanel(panel, maxLines, HEADER_EM / ROW_EM));
  const hasRows = $derived(panel.groups.some((g) => g.rows.length > 0));
  const unavailable = $derived((panel.status === 'unavailable' || panel.status === 'schedule-fallback') && !hasRows);
  /** With nothing listed, "showing schedule" would be untrue, so an empty panel says only what's down. */
  const emptyNotes = $derived.by(() => {
    const notes = panel.notes.filter((n) => !/data delayed$/i.test(n)).map((n) => n.replace(/, showing schedule$/, ''));
    return notes.length > 0 ? [...new Set(notes)] : ['Live data unavailable'];
  });

  /** Room needed, in rows: the first row (with its station header, for the subway), or one line of note. */
  const needed = $derived(
    unavailable ? 0.5 : panel.stations ? 1 : panel.groups[0]?.header ? 1 + HEADER_EM / ROW_EM : 1,
  );
  $effect(() => {
    fits = maxLines >= needed;
  });

  function measure() {
    if (!body) return;
    bodyHeight = body.clientHeight;
    emPx = parseFloat(getComputedStyle(body).fontSize) || 0;
  }

  $effect(() => {
    if (!body) return;
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    return () => ro.disconnect();
  });
</script>

<section class="panel" aria-label={panel.title} style:--row="{ROW_EM}em" style:--header="{HEADER_EM}em">
  <h2 class="title">
    <span class="name">{panel.title}</span>
    {#if !unavailable}{#each panel.notes as note (note)}<span class="flag">{note}</span>{/each}{/if}
  </h2>
  <div class="body" bind:this={body}>
    {#if unavailable}
      {#each emptyNotes as note (note)}<p class="note">{note}</p>{/each}
    {:else if panel.stations}
      <StationList stations={panel.stations.slice(0, Math.floor(maxLines))} />
    {:else}
      {#each shown.groups as group, gi (gi)}
        {#if group.header}
          <div class="station">
            <span class="station-name" use:fit={[{ text: group.header.name }]}></span>
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
    height: 100%;
    background: var(--page);
    padding: 1.2vmin 1.8vmin 0.4vmin;
    display: flex;
    flex-direction: column;
    gap: 0.3em;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .title {
    margin: 0;
    display: flex;
    align-items: baseline;
    /* Notes wrap under the title rather than being cut off in narrow panels. */
    flex-wrap: wrap;
    column-gap: 0.8em;
    row-gap: 0.1em;
    font-family: var(--font-display);
    font-size: 1.3em;
    font-weight: var(--display-medium);
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .name {
    flex: none;
  }
  .flag {
    white-space: normal;
    font-family: var(--font-sans);
    font-size: 0.55em;
    font-weight: 700;
    letter-spacing: 0;
    color: var(--emphasis);
  }
  .note {
    margin: 0.4em 0 0;
    color: var(--muted);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .station {
    height: var(--header);
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 0.6em;
    padding-bottom: 0.15em;
    color: var(--muted);
    white-space: nowrap;
  }
  .station > span {
    font-size: 0.8em;
  }
  .station-name {
    overflow: hidden;
    font-weight: 700;
    color: var(--text);
  }
  .walk {
    flex: none;
  }
</style>
