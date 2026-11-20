import { describe, expect, it } from 'vitest';
import { panelToHide } from './panels';
import type { PanelId } from '../types';

const DEFAULT: PanelId[] = ['subway', 'bus', 'shuttle', 'bikes'];
const TWO: PanelId[][] = [['subway', 'bikes'], ['bus', 'shuttle']];

describe('panelToHide', () => {
  it('hides nothing while every column fits', () => {
    expect(panelToHide(TWO, new Set(), DEFAULT)).toBeUndefined();
  });
  it('hides the lowest-priority panel in the column that ran short', () => {
    expect(panelToHide(TWO, new Set([0]), DEFAULT)).toBe('bikes');
    expect(panelToHide(TWO, new Set([1]), DEFAULT)).toBe('shuttle');
  });
  it('follows a configured order', () => {
    expect(panelToHide(TWO, new Set([1]), ['shuttle', 'subway', 'bus', 'bikes'])).toBe('bus');
  });
  it('never hides a column\'s only panel', () => {
    expect(panelToHide([['subway'], ['bus', 'shuttle']], new Set([0]), DEFAULT)).toBeUndefined();
  });
  it('picks the lowest priority across every column that ran short', () => {
    expect(panelToHide(TWO, new Set([0, 1]), DEFAULT)).toBe('bikes');
  });
  it('ranks a panel missing from the order last', () => {
    expect(panelToHide([['subway', 'bikes']], new Set([0]), ['bikes'])).toBe('subway');
  });
});
