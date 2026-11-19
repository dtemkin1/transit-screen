<script lang="ts">
  import { fit, type Segment } from './fit';
  import { createRotation } from './rotation.svelte';
  import type { Alert } from '../types';

  let { alerts }: { alerts: Alert[] } = $props();

  const rotation = createRotation(() => alerts.length, 10_000);
  const index = $derived(rotation.index);
  const current = $derived(alerts[index]);
  /** The agency leads in bold and is never cut, unless the header already starts with it. */
  const text = $derived.by((): Segment[] => {
    if (!current) return [];
    const { agency, header } = current;
    if (!agency || header.toLowerCase().startsWith(agency.toLowerCase())) return [{ text: header }];
    return [{ text: `${agency}:`, cls: 'agency', keep: true }, { text: ` ${header}` }];
  });
</script>

{#if current}
  <aside class="strip" aria-live="polite">
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 1 21h22L12 2Zm1 15h-2v2h2v-2Zm0-8h-2v6h2V9Z" fill="currentColor" fill-rule="evenodd" />
    </svg>
    <p class="text" use:fit={text}></p>
    {#if alerts.length > 1}<span class="count">{index + 1} of {alerts.length}</span>{/if}
  </aside>
{/if}

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: 0.7em;
    padding: 0.8vmin 1.6vmin;
    background: var(--band);
    color: var(--on-band);
    font-size: 0.85em;
  }
  .icon {
    flex: none;
    color: var(--band-icon);
    width: 1.2em;
    height: 1.2em;
  }
  /* `fit` cuts at a word to the lines the clamp allows, so the clamp never cuts a word. */
  .text {
    flex: 1;
    margin: 0;
    min-width: 0;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  /* Narrow screens get a third line, so the alert isn't cut mid-sentence. */
  :global([data-layout='portrait']) .text {
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }
  .text :global(.agency) {
    font-weight: 700;
  }
  .count {
    flex: none;
    font-size: 0.85em;
  }
</style>
