/**
 * SA+P frame colors (sap.mit.edu `sap-panel-*`), each with the dark partner the site pairs it with;
 * the light frames are too pale to separate panels on gray, so rails use the partner.
 */
export const PALETTES = {
  /** The color of the site's Met Warehouse page. */
  apricot: { frame: '#ffc486', onFrame: '#000000', rail: '#6b0033', brand: 'sap' },
  yellow: { frame: '#e0fd65', onFrame: '#000000', rail: '#707f00', brand: 'sap' },
  pink: { frame: '#eeb1ff', onFrame: '#000000', rail: '#02777c', brand: 'sap' },
  blue: { frame: '#9ab1ff', onFrame: '#000000', rail: '#6b0033', brand: 'sap' },
  orange: { frame: '#fd6234', onFrame: '#000000', rail: '#6b0033', brand: 'sap' },
  green: { frame: '#707f00', onFrame: '#000000', rail: '#707f00', brand: 'sap' },
  /** MIT (brand.mit.edu/color): black with red accents, for buildings outside SA+P. Its `brand` picks MIT's type and accents in board.css. */
  mit: { frame: '#000000', onFrame: '#ffffff', rail: '#000000', brand: 'mit' },
} as const;

export type PaletteName = keyof typeof PALETTES;
export type Palette = (typeof PALETTES)[PaletteName];
export type PaletteChoice = PaletteName | 'rotate';

/** The SA+P colors "rotate" cycles through, one per service day. */
export const ROTATION: readonly PaletteName[] = ['apricot', 'yellow', 'pink', 'blue', 'orange', 'green'];

export function isPaletteName(s: string): s is PaletteName {
  return Object.hasOwn(PALETTES, s);
}

/** "rotate" picks a new palette each service day ('YYYYMMDD'); the board reloads daily at 04:00. */
export function paletteFor(choice: PaletteChoice, serviceDate: string): Palette {
  if (choice !== 'rotate') return PALETTES[choice];
  const day = Date.UTC(+serviceDate.slice(0, 4), +serviceDate.slice(4, 6) - 1, +serviceDate.slice(6, 8)) / 86_400_000;
  return PALETTES[ROTATION[day % ROTATION.length]];
}
