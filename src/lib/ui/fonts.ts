import { ADOBE_FONTS_KIT } from '$app/env/public';

/** Loads the optional Adobe Fonts web project (see README). Without it, pages use the fallback font stacks. */
export function loadAdobeFonts(kit: string | undefined = ADOBE_FONTS_KIT): void {
  if (!kit) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://use.typekit.net/${kit}.css`;
  document.head.append(link);
}
