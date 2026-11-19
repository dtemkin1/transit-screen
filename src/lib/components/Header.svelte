<script lang="ts">
  import { TZ } from '../time';

  let { name, place, now }: { name: string; place: string; now: number } = $props();

  const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  // "9:44" large, "PM" small: the digits are what people read from across the room.
  const clock = $derived.by(() => {
    const parts = clockFmt.formatToParts(now);
    const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
    const time = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
    return { time, period };
  });
  const iso = $derived(new Date(now).toISOString());
</script>

<header>
  <h1>
    <span class="building">{name}</span>
    {#if place}<span class="place">{place}</span>{/if}
  </h1>
  <time datetime={iso}>{clock.time}{#if clock.period}<small> {clock.period}</small>{/if}</time>
</header>

<style>
  /* The top of the frame: SA+P pages open with the title set large on the frame color. */
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 2vmin;
    padding: 1.2vmin 2.2vmin 0.9vmin;
    background: var(--frame);
    color: var(--on-frame);
  }
  h1 {
    margin: 0;
    min-width: 0;
    display: flex;
    align-items: baseline;
    /* The place name drops to its own line when it doesn't fit beside the building number. */
    flex-wrap: wrap;
    column-gap: 0.5em;
    row-gap: 0.1em;
    font-weight: 400;
    white-space: nowrap;
  }
  .building {
    font-family: var(--font-display);
    font-size: 1.7em;
    font-weight: 500;
    letter-spacing: -0.025em;
    line-height: 1;
  }
  .place {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-serif);
    font-size: 1.2em;
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
