/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  // Tests compile runes for Svelte's client runtime and resolve `svelte` to it (so flushSync is
  // the real one): the server build never runs $effect.
  plugins: [svelte(process.env.VITEST ? { dynamicCompileOptions: () => ({ generate: 'client' }) } : {})],
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { TZ: 'UTC' },
  },
})
