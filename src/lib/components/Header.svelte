<script lang="ts">
  import { TZ } from '../time';

  let { name, now }: { name: string; now: number } = $props();

  const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const clock = $derived(clockFmt.format(now));
  const iso = $derived(new Date(now).toISOString());
</script>

<header>
  <h1><span class="lead">Leaving</span> {name}</h1>
  <time datetime={iso}>{clock}</time>
</header>

<style>
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 2vmin;
  }
  h1 {
    margin: 0;
    font-size: 1.6em;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .lead {
    color: var(--muted);
    font-weight: 500;
  }
  time {
    font-size: 1.6em;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
