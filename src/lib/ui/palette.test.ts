import { describe, expect, it } from 'vitest';
import { contrastRatio } from './format';
import { PALETTES, ROTATION, isPaletteName, paletteFor } from './palette';

const PAGE = '#f5f5f5';

describe('paletteFor', () => {
  it('a named palette is used every day', () => {
    expect(paletteFor('apricot', '20261117')).toEqual(PALETTES.apricot);
    expect(paletteFor('apricot', '20261118')).toEqual(PALETTES.apricot);
  });

  it('"rotate" moves to the next SA+P palette each service day and cycles through all of them', () => {
    const names = ROTATION;
    const days = Array.from({ length: names.length }, (_, i) => `202611${String(17 + i).padStart(2, '0')}`);
    const picked = days.map((d) => paletteFor('rotate', d));
    expect(new Set(picked.map((p) => p.frame)).size).toBe(names.length);
    expect(paletteFor('rotate', '20261117')).toEqual(paletteFor('rotate', '20261117'));
    expect(picked).not.toContainEqual(PALETTES.mit);
  });

  it('rotation continues across month and year boundaries', () => {
    expect(paletteFor('rotate', '20261231')).not.toEqual(paletteFor('rotate', '20270101'));
  });
});

describe('PALETTES', () => {
  it('match the SA+P frame colors and their dark partners from sap.mit.edu', () => {
    expect(PALETTES.apricot).toEqual({ frame: '#ffc486', onFrame: '#000000', rail: '#6b0033', brand: 'sap' });
    expect(PALETTES.pink).toEqual({ frame: '#eeb1ff', onFrame: '#000000', rail: '#02777c', brand: 'sap' });
  });
  it('text on every frame passes 4.5:1, so small header text (like "PM") reads', () => {
    for (const p of Object.values(PALETTES)) expect(contrastRatio(p.onFrame, p.frame)).toBeGreaterThanOrEqual(4.5);
  });
  it('every rail separates panels at 3:1 or more against the page', () => {
    for (const p of Object.values(PALETTES)) expect(contrastRatio(p.rail, PAGE)).toBeGreaterThanOrEqual(3);
  });
  it('SA+P colors bring SA+P type; MIT red brings MIT type', () => {
    for (const name of ROTATION) expect(PALETTES[name].brand).toBe('sap');
    expect(PALETTES.mit.brand).toBe('mit');
  });
  it('isPaletteName', () => {
    expect(isPaletteName('pink')).toBe(true);
    expect(isPaletteName('rotate')).toBe(false);
    expect(isPaletteName('toString')).toBe(false);
  });
});
