<script lang="ts">
  import { TZ } from '../time';

  /** `tag` marks the board as not live, e.g. "Sample data" in demo mode. */
  let { name, place, now, tag }: { name: string; place: string; now: number; tag?: string } = $props();

  const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  // Digits large, "PM" small: the digits are what people read from across the room.
  const clock = $derived.by(() => {
    const parts = clockFmt.formatToParts(now);
    const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
    const time = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
    return { time, period };
  });
  const iso = $derived(new Date(now).toISOString());
</script>

<header>
  <h1 class="visually-hidden">{name}{place ? ` ${place}` : ''}</h1>
  <span class="building" aria-hidden="true">{name}</span>
  {#if place}<span class="place" aria-hidden="true">{place}</span>{/if}
  <div class="side">
    {#if tag}<span class="tag">{tag}</span>{/if}
    <time datetime={iso}>{clock.time}{#if clock.period}<small> {clock.period}</small>{/if}</time>
  </div>
</header>

<style>
  /* One baseline-aligned row; in portrait the place name gets its own full-width row. */
  header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: 'building place side';
    align-items: baseline;
    column-gap: 0.8em;
    padding: 1.2vmin 2.2vmin 0.9vmin;
    background: var(--frame);
    color: var(--on-frame);
  }
  :global([data-layout='portrait']) header {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas: 'building side' 'place place';
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .building {
    grid-area: building;
    font-family: var(--font-display);
    font-size: 3.4em;
    font-weight: 500;
    letter-spacing: -0.025em;
    line-height: 1;
    white-space: nowrap;
  }
  .place {
    grid-area: place;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-serif);
    /* Capped by width so "Metropolitan Warehouse" fits a phone instead of being cut. */
    font-size: min(2.4em, 8vw);
  }
  .side {
    grid-area: side;
    justify-self: end;
    display: flex;
    align-items: baseline;
    gap: 0.8em;
  }
  .tag {
    padding: 0.1em 0.4em;
    border: 2px solid currentColor;
    font-size: 0.75em;
    font-weight: 700;
  }
  time {
    font-family: var(--font-display);
    font-size: 1.45em;
    font-weight: 500;
    white-space: nowrap;
  }
  time small {
    margin-left: 0.2em;
    font-size: 0.55em;
    letter-spacing: 0.02em;
  }
</style>
