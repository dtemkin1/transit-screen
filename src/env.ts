import { defineEnvVars } from '@sveltejs/kit/env';

const LOCAL_WORKER = 'http://localhost:8787';

/** Unset or empty (an unset CI variable, say) means the local dev Worker; anything else must be an http(s) URL. */
export function parseWorkerUrl(value: string | undefined): string {
  if (!value) return LOCAL_WORKER;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`WORKER_URL isn't a URL: "${value}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`WORKER_URL must be http(s): "${value}"`);
  return value;
}

/** An Adobe Fonts web project id, or undefined for none. It becomes part of a stylesheet URL, so it's checked. */
export function parseFontsKit(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^[a-z0-9]+$/i.test(value)) throw new Error(`ADOBE_FONTS_KIT must be a project id (letters and digits): "${value}"`);
  return value;
}

// Read at build time from the environment or a .env file, checked, and inlined into the pages.
export const variables = defineEnvVars({
  WORKER_URL: {
    public: true,
    static: true,
    description: 'The Worker that proxies the transit APIs. Defaults to the local dev Worker.',
    schema: parseWorkerUrl,
  },
  ADOBE_FONTS_KIT: {
    public: true,
    static: true,
    description: 'Adobe Fonts web project id (see README). Without it, the fallback fonts are used.',
    schema: parseFontsKit,
  },
});
