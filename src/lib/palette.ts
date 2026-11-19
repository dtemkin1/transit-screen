// SA+P frame colors (sap.mit.edu `sap-panel-*`), each with the dark partner the site pairs it
// with; the light frames are too pale to separate panels on gray, so rails use the partner.
export const PALETTES = {
  apricot: { frame: '#ffc486', onFrame: '#000000', rail: '#6b0033' }, // the Met Warehouse page
  yellow: { frame: '#e0fd65', onFrame: '#000000', rail: '#707f00' },
  pink: { frame: '#eeb1ff', onFrame: '#000000', rail: '#02777c' },
  blue: { frame: '#9ab1ff', onFrame: '#000000', rail: '#6b0033' },
  orange: { frame: '#fd6234', onFrame: '#000000', rail: '#6b0033' },
  green: { frame: '#707f00', onFrame: '#000000', rail: '#707f00' },
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
