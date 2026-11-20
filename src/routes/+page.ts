import { readOptions } from '#lib/config/options.ts';
import { resolveConfig } from '#lib/config/resolve.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => ({
  cfg: resolveConfig(readOptions(url.search)),
  /** `?demo` on the dev server shows sample data covering every state (src/lib/data/demo.svelte.ts). */
  demo: url.searchParams.get('demo'),
});
