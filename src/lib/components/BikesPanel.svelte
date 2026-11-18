<script lang="ts">
  import type { BikeStation } from '../types';

  let { stations }: { stations: BikeStation[] } = $props();

  const count = (n: number | undefined) => (n === undefined ? '—' : String(n));
</script>

{#each stations as s (s.id)}
  <div class="line station">
    <div class="top">
      <span class="name">{s.name}</span>
      <span class="walk">{Math.ceil(s.walkSec / 60)} min walk</span>
    </div>
    {#if s.renting === false}
      <div class="counts closed">Closed</div>
    {:else}
      <div class="counts">
        <span><b>{count(s.bikes)}</b> bikes</span>
        <span><b>{count(s.ebikes)}</b> e-bikes</span>
        <span><b>{count(s.docks)}</b> docks</span>
      </div>
    {/if}
  </div>
{/each}

<style>
  .station {
    height: var(--line);
    display: flex;
    flex-direction: column;
    justify-content: center;
    line-height: 1.2;
    min-width: 0;
  }
  .top {
    display: flex;
    justify-content: space-between;
    gap: 0.6em;
    white-space: nowrap;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .walk {
    flex: none;
    color: var(--muted);
    font-size: 0.75em;
    align-self: center;
  }
  .counts {
    display: flex;
    gap: 0.9em;
    color: var(--muted);
    font-size: 0.85em;
    white-space: nowrap;
    overflow: hidden;
  }
  .counts b {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .closed {
    font-style: italic;
  }
</style>
