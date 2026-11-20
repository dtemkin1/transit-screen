import { isPaletteName, type PaletteChoice } from '../ui/palette';
import type { PanelId } from '../types';

export const PANEL_IDS: readonly PanelId[] = ['subway', 'bus', 'shuttle', 'bikes'];

/**
 * What a board URL can say, field for field, as the setup form edits it. A field at its value in
 * `NO_OPTIONS` says nothing: the board's default, or what the building implies.
 */
export interface BoardOptions {
  building: string;
  name: string;
  /** '' for the building's own colors. */
  palette: PaletteChoice | '';
  priority: PanelId[];
  /** Already clamped to 0-10. */
  inset: number;
  /** Text as typed: a number, or '' for the building's own location. */
  lat: string;
  lon: string;
  pin: string[];
  hide: string[];
}

/** "a, b,,a" → ['a', 'b']. */
export const parseList = (text: string) => [...new Set(text.split(',').map((s) => s.trim()).filter(Boolean))];

/** "shuttle,subway" puts those first, in that order; panels it leaves out follow in default order. */
export function parsePriority(raw: string): PanelId[] {
  const named = parseList(raw).filter((s): s is PanelId => (PANEL_IDS as readonly string[]).includes(s));
  return [...new Set([...named, ...PANEL_IDS])];
}

/** A number as typed, or undefined when it isn't one. */
const numeric = (raw: string) => (raw.trim() !== '' && Number.isFinite(Number(raw)) ? raw.trim() : undefined);

/**
 * Every board URL parameter, in the order a URL lists them, with how to read its value (undefined:
 * ignore it). Writing is the same for all: see `write`.
 */
const PARAMS: { [K in keyof BoardOptions]: (raw: string) => BoardOptions[K] | undefined } = {
  building: (raw) => raw.trim() || undefined,
  name: (raw) => raw,
  palette: (raw) => (raw === 'rotate' || isPaletteName(raw) ? raw : undefined),
  priority: parsePriority,
  inset: (raw) => (numeric(raw) === undefined ? undefined : Math.min(10, Math.max(0, Number(raw)))),
  lat: numeric,
  lon: numeric,
  pin: parseList,
  hide: parseList,
};

export const NO_OPTIONS: Readonly<BoardOptions> = {
  building: 'W41', name: '', palette: '', priority: [...PANEL_IDS], inset: 0, lat: '', lon: '', pin: [], hide: [],
};

export const OPTION_KEYS = Object.keys(PARAMS) as (keyof BoardOptions)[];

/** A field's query value: a list joined with commas, anything else as text. */
const write = (value: BoardOptions[keyof BoardOptions]) => (Array.isArray(value) ? value.join(',') : String(value));

/** Whether `key` says nothing in `options`. */
const isUnset = (options: BoardOptions, key: keyof BoardOptions) => write(options[key]) === write(NO_OPTIONS[key]);

export function readOptions(search: string): BoardOptions {
  const params = new URLSearchParams(search);
  const options = structuredClone(NO_OPTIONS) as BoardOptions;
  for (const key of OPTION_KEYS) {
    const raw = params.get(key);
    const value = raw === null ? undefined : PARAMS[key](raw);
    if (value !== undefined) (options as unknown as Record<string, unknown>)[key] = value;
  }
  return options;
}

/** The query for `options`, set fields only; '' when none is set, else "?building=32&…". */
export function writeOptions(options: BoardOptions): string {
  const params = new URLSearchParams();
  for (const key of OPTION_KEYS) {
    if (!isUnset(options, key)) params.set(key, write(options[key]));
  }
  // Commas and colons are legal in a query; left unescaped, the lists ("mbta:70,1") stay readable.
  const query = params.toString().replace(/%2C/gi, ',').replace(/%3A/gi, ':');
  return query ? `?${query}` : '';
}
