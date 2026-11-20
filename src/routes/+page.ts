import { resolveConfig } from '../config';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => ({
  cfg: resolveConfig(url.search),
  /** `?demo` on the dev server shows sample data covering every state (src/lib/data/demo.svelte.ts). */
  demo: url.searchParams.get('demo'),
});
