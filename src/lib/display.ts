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

/** The colored route marker: short names up to 4 characters as is, longer ones as initials. */
export function routeBadge(r: RouteInfo): Badge {
  if (r.source === 'ezride') return { text: 'EZ', bg: EZRIDE_COLOR, fg: '#FFFFFF' };
  const name = r.shortName || r.longName;
  const text = name.length <= 4
    ? name
    : name.split(/[\s/-]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  return {
    text,
    bg: HEX.test(r.color) ? r.color : '#5F6368',
    fg: HEX.test(r.textColor) ? r.textColor : '#FFFFFF',
  };
}

export function plural(n: number, noun: string): string {
  return n === 1 ? noun : `${noun}s`;
}

export function countNoun(n: number, noun: string): string {
  return `${n} ${plural(n, noun)}`;
}
