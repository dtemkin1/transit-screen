<script lang="ts">
  import { createRotation } from '../rotation.svelte';
  import type { Alert } from '../types';

  let { alerts }: { alerts: Alert[] } = $props();

  const rotation = createRotation(() => alerts.length, 10_000);
  const index = $derived(rotation.index);
  const current = $derived(alerts[index]);
</script>

{#if current}
  <aside class="strip" aria-live="polite">
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 1 21h22L12 2Zm1 15h-2v2h2v-2Zm0-8h-2v6h2V9Z" fill="currentColor" fill-rule="evenodd" />
    </svg>
    <p class="text">{current.header}</p>
    {#if alerts.length > 1}<span class="count">{index + 1}/{alerts.length}</span>{/if}
  </aside>
{/if}

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: 0.8em;
    padding: 0.7vmin 1.4vmin;
    border-radius: 0.8vmin;
    background: var(--alert-bg);
    color: var(--alert-text);
  }
  .icon {
    flex: none;
    width: 1.2em;
    height: 1.2em;
  }
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
  .count {
    flex: none;
    font-size: 0.8em;
    font-variant-numeric: tabular-nums;
  }
</style>
