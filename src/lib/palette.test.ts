import { describe, expect, it } from 'vitest';
import { PALETTES, isPaletteName, paletteFor } from './palette';

describe('paletteFor', () => {
  it('a named palette is used every day', () => {
    expect(paletteFor('apricot', '20261117')).toEqual(PALETTES.apricot);
    expect(paletteFor('apricot', '20261118')).toEqual(PALETTES.apricot);
  });

  it('"rotate" moves to the next palette each service day and cycles through all of them', () => {
    const names = Object.keys(PALETTES);
    const days = Array.from({ length: names.length }, (_, i) => `202611${String(17 + i).padStart(2, '0')}`);
    const picked = days.map((d) => paletteFor('rotate', d));
    expect(new Set(picked.map((p) => p.frame)).size).toBe(names.length);
    const next = paletteFor('rotate', '20261117');
    expect(paletteFor('rotate', '20261117')).toEqual(next); // same day, same palette
  });

  it('rotation continues across month and year boundaries', () => {
    expect(paletteFor('rotate', '20261231')).not.toEqual(paletteFor('rotate', '20270101'));
  });
});

describe('PALETTES', () => {
  it('match the SA+P frame colors, with readable text on each', () => {
    expect(PALETTES.apricot).toEqual({ frame: '#ffc486', onFrame: '#000000' });
    expect(PALETTES.green).toEqual({ frame: '#707f00', onFrame: '#ffffff' });
  });
  it('isPaletteName', () => {
    expect(isPaletteName('pink')).toBe(true);
    expect(isPaletteName('rotate')).toBe(false);
    expect(isPaletteName('toString')).toBe(false);
  });
});
