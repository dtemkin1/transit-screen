<script lang="ts">
  import { countNoun, plural, shortStopName } from '../display';
  import type { BikeStation } from '../types';

  let { stations }: { stations: BikeStation[] } = $props();

  const walk = (s: BikeStation) => `${Math.ceil(s.walkSec / 60)} min walk`;
</script>

{#each stations as s (s.id)}
  <div class="row">
    <div class="where">
      <span class="name">{shortStopName(s.name)}</span>
      <span class="sub">{walk(s)}{s.ebikes ? `, ${countNoun(s.ebikes, 'e-bike')}` : ''}</span>
    </div>
    <div class="counts">
      {#if s.renting === false}
        <span class="closed">Closed</span>
      {:else if s.bikes === undefined}
        <span class="sub">Status unavailable</span>
      {:else}
        <span class="bikes" class:empty={s.bikes === 0}>{s.bikes}<small> {plural(s.bikes, 'bike')}</small></span>
        {#if s.docks !== undefined}<span class="sub">{countNoun(s.docks, 'open dock')}</span>{/if}
      {/if}
    </div>
  </div>
{/each}

<style>
  .row {
    height: var(--row);
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 0.6em;
    border-top: 1px solid var(--rule);
  }
  .where,
  .counts {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .counts {
    align-items: flex-end;
  }
  .name,
  .sub {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name {
    font-weight: 700;
  }
  .sub {
    font-size: 0.72em;
    color: var(--muted);
  }
  .bikes {
    font-size: 1.3em;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }
  .bikes small {
    margin-left: 0.15em;
    font-size: 0.6em;
    font-weight: 400;
  }
  .empty {
    color: var(--muted);
  }
  .closed {
    color: var(--muted);
    font-style: italic;
  }
</style>
