<script lang="ts">
  import type { Alert } from '../types';

  let { alerts }: { alerts: Alert[] } = $props();

  const ROTATE_MS = 10_000;
  let tick = $state(0);

  $effect(() => {
    if (alerts.length < 2) return;
    const id = setInterval(() => tick++, ROTATE_MS);
    return () => clearInterval(id);
  });

  const index = $derived(alerts.length > 0 ? tick % alerts.length : 0);
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
