import { configSearch, resolveConfig, type Config } from '../../config';
import { isPaletteName, type PaletteChoice } from '../ui/palette';
import type { PanelId } from '../types';

/** The setup form. Empty text fields mean "the default": the building's own name, palette and location. */
export interface SetupForm {
  building: string;
  name: string;
  palette: PaletteChoice | '';
  priority: PanelId[];
  inset: number;
  lat: string;
  lon: string;
  pin: string[];
  hide: string[];
}

/** The form for a board URL's query string, so an existing board can be edited. */
export function formFrom(search: string): SetupForm {
  const params = new URLSearchParams(search);
  const cfg = resolveConfig(search);
  const palette = params.get('palette') ?? '';
  const located = !cfg.locate && params.has('lat');
  return {
    building: cfg.building,
    name: params.get('name') ?? '',
    palette: palette === 'rotate' || isPaletteName(palette) ? palette : '',
    priority: cfg.priority,
    inset: cfg.inset,
    lat: located ? String(cfg.location.lat) : '',
    lon: located ? String(cfg.location.lon) : '',
    pin: cfg.pin,
    hide: cfg.hide,
  };
}

/** The board's config for the form, read the same way the board reads its URL. */
export function formConfig(f: SetupForm): Config {
  const params = new URLSearchParams();
  const set = (key: string, value: string) => { if (value.trim()) params.set(key, value.trim()); };
  set('building', f.building);
  set('name', f.name);
  set('palette', f.palette);
  set('priority', f.priority.join(','));
  set('inset', String(f.inset));
  set('lat', f.lat);
  set('lon', f.lon);
  set('pin', f.pin.join(','));
  set('hide', f.hide.join(','));
  return resolveConfig(params.toString());
}

/** The shortest board query string for the form. */
export const formSearch = (f: SetupForm) => configSearch(formConfig(f));

/** "a, b,,c" → ['a', 'b', 'c'], for the id fields. */
export const parseIds = (text: string) => [...new Set(text.split(',').map((s) => s.trim()).filter(Boolean))];
