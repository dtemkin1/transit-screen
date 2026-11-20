<script lang="ts">
  import { HEADER_EM, ROW_EM, panelFloor } from '../board/size';
  import { trimPanel } from '../board/trim';
  import type { BoardPanel } from '../types';
  import { fit } from './fit';
  import Row from './Row.svelte';
  import StationList from './StationList.svelte';

  let { panel, rows = 0, startHeight = $bindable(), floorHeight = $bindable() }: {
    panel: BoardPanel;
    /** Rows the panel starts at in its column (src/lib/board/size.ts); never less than its floor. */
    rows?: number;
    /** Set by the panel: its height at `rows`, title included, in px. */
    startHeight?: number;
    /** Set by the panel: its least height, title plus its first row (or its notes), in px. */
    floorHeight?: number;
  } = $props();

  let section: HTMLElement | undefined = $state();
  let body: HTMLElement | undefined = $state();
  let bodyHeight = $state(0);
  /** Everything but the body: title, gap and padding, which grow when the title's notes wrap. */
  let chromePx = $state(0);
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

  /** The panel's floor, in rows. */
  const needed = $derived(panelFloor(panel, unavailable ? emptyNotes.length : 0));

  $effect(() => {
    startHeight = rowPx === 0 ? undefined : chromePx + Math.max(rows, needed) * rowPx;
    floorHeight = rowPx === 0 ? undefined : chromePx + needed * rowPx;
  });

  function measure() {
    if (!body || !section) return;
    const b = body.getBoundingClientRect();
    // Unrounded, plus half a pixel: a body sized to exactly one row (the floor) must count as fitting it.
    bodyHeight = b.height + 0.5;
    // From the body's offset, not the section's height, so a squeezed panel doesn't shrink its own floor.
    chromePx = b.top - section.getBoundingClientRect().top + parseFloat(getComputedStyle(section).paddingBottom);
    emPx = parseFloat(getComputedStyle(body).fontSize) || 0;
  }

  $effect(() => {
    if (!body || !section) return;
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    ro.observe(section);
    return () => ro.disconnect();
  });
</script>

<section class="panel" bind:this={section} aria-label={panel.title} style:--row="{ROW_EM}em" style:--header="{HEADER_EM}em" style:--need="{needed * ROW_EM}em">
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
    /* The body row's minimum is the panel's floor; the page sizes slots no smaller, title included. */
    display: grid;
    grid-template-rows: auto minmax(var(--need), 1fr);
    row-gap: 0.3em;
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
  /* Size containment keeps the rows out of the panel's minimum height, so its floor is --need alone. */
  .body {
    min-height: 0;
    overflow: hidden;
    contain: size;
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
