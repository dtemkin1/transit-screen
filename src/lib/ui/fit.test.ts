import { describe, expect, it } from 'vitest';
import { fitOptions, fitWords, type Segment } from './fit';

// A stand-in for measuring: text fits when it is at most `max` characters.
const width = (max: number) => (segs: Segment[]) => segs.map((s) => s.text).join('').length <= max;
const text = (segs: Segment[]) => segs.map((s) => s.text).join('');
const words = (s: string) => s.replace(/…$/, '').split(/\s+/).filter(Boolean);

describe('fitWords', () => {
  const dest: Segment[] = [{ text: 'Spring Hill' }, { text: ' via Union Sq & Somerville Ave', cls: 'toward' }];

  it('leaves text that fits alone', () => {
    expect(fitWords(dest, width(100))).toBe(dest);
  });

  it('cuts after the last whole word that fits, across segments, keeping their classes', () => {
    expect(fitWords(dest, width(26))).toEqual([{ text: 'Spring Hill' }, { text: ' via Union Sq…', cls: 'toward' }]);
    expect(fitWords(dest, width(14))).toEqual([{ text: 'Spring Hill…' }]);
  });

  it('never ends on a part of a word, at any width', () => {
    const full = text(dest);
    const all = words(full);
    for (let max = 1; max <= full.length; max++) {
      const shown = words(text(fitWords(dest, width(max))));
      expect(all.slice(0, shown.length), `width ${max}`).toEqual(shown);
    }
  });

  it('keeps the space between segments when the cut comes later', () => {
    const sub: Segment[] = [{ text: 'Approaching', cls: 'status' }, { text: '. ' }, { text: 'Vassar St @ Mass Ave, 2 min walk' }];
    expect(text(fitWords(sub, width(36)))).toBe('Approaching. Vassar St @ Mass Ave…');
  });

  it('drops a dangling "&", "@" or comma before the ellipsis', () => {
    expect(text(fitWords([{ text: 'Union Sq & Somerville Ave' }], width(12)))).toBe('Union Sq…');
    expect(text(fitWords([{ text: 'Mass Ave @ Albany St' }], width(11)))).toBe('Mass Ave…');
    expect(text(fitWords([{ text: 'Detour: Main St, Vassar St' }], width(17)))).toBe('Detour: Main St…');
  });

  it('drops a dangling connecting word, even when it ends a segment', () => {
    expect(fitWords([{ text: 'Tech Shuttle' }, { text: ' to Kendall Sq T', cls: 'toward' }], width(16)))
      .toEqual([{ text: 'Tech Shuttle…' }]);
    expect(text(fitWords([{ text: 'Spring Hill via Union Sq' }], width(16)))).toBe('Spring Hill…');
    expect(text(fitWords([{ text: 'Harvard St at Vassar opp Main' }], width(14)))).toBe('Harvard St…');
  });

  it('shows only the ellipsis when not even one word fits', () => {
    expect(fitWords([{ text: 'Massachusetts' }], width(5))).toEqual([{ text: '…' }]);
  });

  it('cuts sooner when the cut alone would read as profane', () => {
    // A real stop: allowed in full, but "…@ Hooker…" on its own would not be.
    const stop: Segment[] = [{ text: 'N Harvard St @ Hooker St' }];
    expect(text(fitWords(stop, width(22)))).toBe('N Harvard St…');
    expect(text(fitWords(stop, width(100)))).toBe('N Harvard St @ Hooker St');
  });

  it('a name that is flagged in full (a false positive) is still cut normally', () => {
    expect(text(fitWords([{ text: 'Shit Creek Rd and Beyond' }], width(16)))).toBe('Shit Creek Rd…');
  });
});

describe('keep: text that is never split', () => {
  const sub: Segment[] = [
    { text: 'Approaching', cls: 'status', keep: true }, { text: '. ' },
    { text: 'Vassar St @ Mass Ave' }, { text: ', 2 min walk', keep: true },
  ];

  it('cuts the other text first, keeping the walk time whole after the "…"', () => {
    expect(text(fitWords(sub, width(36)))).toBe('Approaching. Vassar St…, 2 min walk');
  });

  it('drops the other text cleanly when not one word of it fits, with no stray "…" or comma', () => {
    expect(text(fitWords(sub, width(26)))).toBe('Approaching, 2 min walk');
    const walkOnly: Segment[] = [{ text: 'Massachusetts Ave @ Albany St' }, { text: ', 3 min walk', keep: true }];
    expect(text(fitWords(walkOnly, width(14)))).toBe('3 min walk');
    // A lone "…" is the last resort when nothing fits; otherwise nothing starts with "…" or a comma.
    for (let max = 1; max <= text(walkOnly).length; max++) {
      const shown = text(fitWords(walkOnly, width(max)));
      if (shown !== '…') expect(shown, `width ${max}`).not.toMatch(/^[…,]/);
    }
  });

  it('never leaves part of it, such as a bare number, at any width', () => {
    for (let max = 1; max <= text(sub).length; max++) {
      const shown = text(fitWords(sub, width(max)));
      expect(/\b2\b(?! min walk)/.test(shown), `width ${max}: ${shown}`).toBe(false);
    }
  });

  it('drops it whole as a last resort', () => {
    const seg: Segment[] = [{ text: 'Vassar St' }, { text: ', 2 min walk', keep: true }];
    expect(text(fitWords(seg, width(10)))).toBe('2 min walk');
    expect(text(fitWords(seg, width(9)))).toBe('Vassar…');
  });
});

describe('fitOptions', () => {
  const named: Segment[] = [{ text: 'Tech Shuttle' }, { text: ' to Kendall Sq T', cls: 'toward' }];
  const dest: Segment[] = [{ text: 'Kendall Sq T' }];

  it('takes the first option that fits whole', () => {
    expect(fitOptions([named, dest], width(40))).toBe(named);
    expect(fitOptions([named, dest], width(14))).toBe(dest);
  });

  it('cuts the last option when none fits whole', () => {
    expect(text(fitOptions([named, dest], width(9)))).toBe('Kendall…');
  });
});
