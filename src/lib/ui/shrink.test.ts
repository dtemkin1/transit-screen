import { describe, expect, it } from 'vitest';
import { fitSize } from './shrink';

describe('fitSize', () => {
  it('keeps the full size when the text fits', () => {
    expect(fitSize(400, 500, 60, 25)).toEqual({ px: 60, wrap: false });
  });
  it('scales down in proportion to fit one line', () => {
    expect(fitSize(1000, 500, 60, 25)).toEqual({ px: 30, wrap: false });
  });
  it('stops at the floor and wraps instead of going smaller', () => {
    expect(fitSize(2000, 500, 60, 25)).toEqual({ px: 25, wrap: true });
  });
});
