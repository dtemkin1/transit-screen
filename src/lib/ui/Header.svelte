<script lang="ts">
  import { TZ } from '../util/time';
  import { shrinkToFit } from './shrink';

  let { building, name, now, tag }: {
    building: string;
    name: string;
    now: number;
    /** Marks the board as not live, e.g. "Sample data" in demo mode. */
    tag?: string;
  } = $props();

  const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  /** Digits large, "PM" small: the digits are what people read from across the room. */
  const clock = $derived.by(() => {
    const parts = clockFmt.formatToParts(now);
    const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
    const time = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
    return { time, period };
  });
  const iso = $derived(new Date(now).toISOString());
</script>

<header>
  <h1 class="visually-hidden">{building}{name ? ` ${name}` : ''}</h1>
  <span class="building" aria-hidden="true">{building}</span>
  {#if name}<span class="name" aria-hidden="true" use:shrinkToFit={name}></span>{/if}
  <div class="side">
    {#if tag}<span class="tag">{tag}</span>{/if}
    <time datetime={iso}>{clock.time}{#if clock.period}<small> {clock.period}</small>{/if}</time>
  </div>
</header>

<style>
  /* One baseline-aligned row; in portrait the name gets its own full-width row. */
  header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: 'building name side';
    align-items: baseline;
    column-gap: 0.8em;
    padding: 1.2vmin 2.2vmin 0.9vmin;
    background: var(--frame);
    color: var(--on-frame);
  }
  :global([data-layout='portrait']) header {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas: 'building side' 'name name';
  }
  .building {
    grid-area: building;
    color: var(--building, inherit);
    font-family: var(--font-display);
    font-size: 3.4em;
    font-weight: var(--display-medium);
    letter-spacing: -0.025em;
    line-height: 1;
    white-space: nowrap;
  }
  /* Never cut: `shrinkToFit` makes it smaller to fit, and wraps it between words below body size. */
  .name {
    grid-area: name;
    min-width: 0;
    white-space: nowrap;
    line-height: 1.1;
    font-family: var(--font-name, var(--font-accent));
    font-size: 2.4em;
  }
  /* On a narrow screen the tag moves to its own line rather than over the building number. */
  .side {
    grid-area: side;
    justify-self: end;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: baseline;
    gap: 0.2em 0.8em;
  }
  .tag {
    padding: 0.1em 0.4em;
    border: 2px solid currentColor;
    font-size: 0.75em;
    font-weight: 700;
    white-space: nowrap;
  }
  time {
    font-family: var(--font-display);
    font-size: 1.45em;
    font-weight: var(--display-medium);
    white-space: nowrap;
  }
  time small {
    margin-left: 0.2em;
    font-size: 0.55em;
    letter-spacing: 0.02em;
  }
</style>
