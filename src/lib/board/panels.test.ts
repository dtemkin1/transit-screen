import { describe, expect, it } from 'vitest';
import { panelToHide } from './panels';
import type { PanelId } from '../types';

const ALL: PanelId[] = ['subway', 'bus', 'shuttle', 'bikes'];
const DEFAULT: PanelId[] = ['subway', 'bus', 'shuttle', 'bikes'];

describe('panelToHide', () => {
  it('hides nothing while every panel fits a row', () => {
    expect(panelToHide(ALL, { subway: true, bus: true, shuttle: true, bikes: true }, DEFAULT)).toBeUndefined();
    expect(panelToHide(ALL, {}, DEFAULT)).toBeUndefined();
  });
  it('hides the lowest-priority panel shown, not necessarily the one that does not fit', () => {
    expect(panelToHide(ALL, { bus: false }, DEFAULT)).toBe('bikes');
    expect(panelToHide(['subway', 'bus', 'shuttle'], { bus: false }, DEFAULT)).toBe('shuttle');
  });
  it('follows a configured order', () => {
    expect(panelToHide(ALL, { bus: false }, ['shuttle', 'bikes', 'subway', 'bus'])).toBe('bus');
  });
  it('never hides the last panel', () => {
    expect(panelToHide(['subway'], { subway: false }, DEFAULT)).toBeUndefined();
  });
  it('ranks a panel missing from the order last', () => {
    expect(panelToHide(['subway', 'bikes'], { subway: false }, ['bikes'])).toBe('subway');
  });
});
