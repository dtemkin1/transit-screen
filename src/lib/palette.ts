/**
 * SA+P frame colors (sap.mit.edu `sap-panel-*`): each page of their site is framed in one.
 * `onFrame` is the text color that reads on it (black, except white on green, which the
 * board only uses for large header text: 4.4:1).
 */
export const PALETTES = {
  apricot: { frame: '#ffc486', onFrame: '#000000' }, // the Met Warehouse page
  yellow: { frame: '#e0fd65', onFrame: '#000000' },
  pink: { frame: '#eeb1ff', onFrame: '#000000' },
  blue: { frame: '#9ab1ff', onFrame: '#000000' },
  orange: { frame: '#fd6234', onFrame: '#000000' },
  green: { frame: '#707f00', onFrame: '#ffffff' },
} as const;

export type PaletteName = keyof typeof PALETTES;
export type Palette = (typeof PALETTES)[PaletteName];
export type PaletteChoice = PaletteName | 'rotate';

export function isPaletteName(s: string): s is PaletteName {
  return Object.hasOwn(PALETTES, s);
}

/** "rotate" picks a new palette each service day ('YYYYMMDD'); the board reloads daily at 04:00. */
export function paletteFor(choice: PaletteChoice, serviceDate: string): Palette {
  if (choice !== 'rotate') return PALETTES[choice];
  const names = Object.keys(PALETTES) as PaletteName[];
  const day = Date.UTC(+serviceDate.slice(0, 4), +serviceDate.slice(4, 6) - 1, +serviceDate.slice(6, 8)) / 86_400_000;
  return PALETTES[names[day % names.length]];
}
