/// <reference types="vitest/config" />
import adapter from '@sveltejs/adapter-static'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

// https://svelte.dev/docs/kit/@sveltejs-kit-vite
export default defineConfig({
  plugins: [
    sveltekit({
      // Every page is a prerendered shell (src/routes/+layout.ts) in build/, which the deploy publishes.
      adapter: adapter(),
      // Screens reload when this changes (src/routes/+page.svelte). The commit, not the build time,
      // so the daily scheduled rebuild doesn't reload every screen for nothing.
      version: { name: process.env.GITHUB_SHA },
      // Tests compile runes for Svelte's client runtime and resolve `svelte` to it (so flushSync is
      // the real one): the server build never runs $effect.
      ...(process.env.VITEST && { dynamicCompileOptions: () => ({ generate: 'client' as const }) }),
    }),
  ],
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/test/**/*.test.ts'],
    env: { TZ: 'UTC' },
  },
})
