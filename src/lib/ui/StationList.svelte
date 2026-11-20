<script lang="ts">
  import { fit } from './fit';
  import { abbreviate, countNoun, plural } from './format';
  import type { Station } from '../types';

  let { stations }: { stations: Station[] } = $props();

  const walk = (s: Station) => `${Math.ceil(s.walkSec / 60)} min walk`;
  const electric = (s: Station) => (s.electric && s.unit.electric ? `, ${countNoun(s.electric, s.unit.electric)}` : '');
</script>

{#each stations as s (`${s.source}:${s.id}`)}
  <div class="row">
    <div class="where">
      <span class="name" use:fit={[{ text: abbreviate(s.name) }]}></span>
      <span class="sub" use:fit={[{ text: walk(s) + electric(s) }]}></span>
    </div>
    <div class="counts">
      {#if s.open === false}
        <span class="closed">Closed</span>
      {:else if s.available === undefined}
        <span class="sub">Status unavailable</span>
      {:else}
        <span class="count" class:empty={s.available === 0}>{s.available}<small> {plural(s.available, s.unit.one)}</small></span>
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
  }
  .name {
    font-weight: 700;
  }
  .sub {
    font-size: 0.72em;
    color: var(--muted);
  }
  .count {
    font-size: 1.3em;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }
  .count small {
    margin-left: 0.15em;
    font-size: 0.6em;
    font-weight: 400;
  }
  .empty {
    color: var(--muted);
  }
  .closed {
    color: var(--muted);
  }
</style>
