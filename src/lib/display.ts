import type { RouteInfo } from './types';

/** EZRide's agency color in Passio. Every EZRide route runs under one banner, so all share it. */
export const EZRIDE_COLOR = '#1F77B4';

const HEX = /^#[0-9a-f]{6}$/i;
const ABBREVIATIONS: [RegExp, string][] = [
  [/\bMassachusetts\b/g, 'Mass'],
  [/\bAvenue\b/g, 'Ave'],
  [/\bStreet\b/g, 'St'],
];

/** Shortens long stop names so the useful part fits: "Massachusetts Ave @ Albany St" → "Mass Ave @ Albany St". */
export function shortStopName(name: string): string {
  let out = name.trim();
  for (const [re, short] of ABBREVIATIONS) out = out.replace(re, short);
  return out.replace(/\.$/, '');
}

export interface Badge { text: string; bg: string; fg: string }

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio of two '#RRGGBB' colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Badge text is large and bold, so 3:1 (WCAG large text) is the floor. */
const BADGE_MIN_CONTRAST = 3;

// Route marker: short names as is, long ones as initials; text color falls back to black or white
// when the feed's doesn't read (some Passio routes have none).
export function routeBadge(r: RouteInfo): Badge {
  if (r.source === 'ezride') return { text: 'EZ', bg: EZRIDE_COLOR, fg: '#FFFFFF' };
  const name = r.shortName || r.longName;
  const text = name.length <= 4
    ? name
    : name.split(/[\s/-]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  const bg = HEX.test(r.color) ? r.color : '#5F6368';
  const given = HEX.test(r.textColor) ? r.textColor : undefined;
  const fg = given && contrastRatio(given, bg) >= BADGE_MIN_CONTRAST
    ? given
    : contrastRatio('#000000', bg) >= contrastRatio('#FFFFFF', bg) ? '#000000' : '#FFFFFF';
  return { text, bg, fg };
}

export function plural(n: number, noun: string): string {
  return n === 1 ? noun : `${noun}s`;
}

export function countNoun(n: number, noun: string): string {
  return `${n} ${plural(n, noun)}`;
}
