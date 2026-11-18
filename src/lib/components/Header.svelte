<script lang="ts">
  import { TZ } from '../time';

  let { name, place, now }: { name: string; place: string; now: number } = $props();

  const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const clock = $derived(clockFmt.format(now));
  const iso = $derived(new Date(now).toISOString());
</script>

<header>
  <h1>
    <span class="building">{name}</span>
    {#if place}<span class="place">{place}</span>{/if}
  </h1>
  <time datetime={iso}>{clock}</time>
</header>

<style>
  /* The top of the frame: SA+P pages open with the title set large on the frame color. */
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 2vmin;
    padding: 1.4vmin 2.2vmin 1vmin;
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
    font-size: 1.9em;
    font-weight: 500;
    letter-spacing: -0.025em;
    line-height: 1;
  }
  .place {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-serif);
    font-size: 1.3em;
  }
  time {
    font-family: var(--font-display);
    font-size: 1.5em;
    font-weight: 500;
    letter-spacing: 0;
    white-space: nowrap;
  }
</style>
