<script lang="ts">
  import '../base.css';
  import type { Snippet } from 'svelte';
  import { loadAdobeFonts } from '#lib/ui/fonts.ts';

  let { children }: { children: Snippet } = $props();

  loadAdobeFonts();
</script>

{@render children()}
