import { describe, expect, it } from 'vitest';
import { isAllowlisted, isIndecent } from './decency';

describe('isIndecent', () => {
  it('catches profanity, look-alike characters and stretched letters', () => {
    for (const s of ['shit', 'Sh1t happens', 'sh!t', 'shiiiit', 'FUCKING detour', 'f*ck', 'a$$hole', 'b1tch']) expect(isIndecent(s), s).toBe(true);
  });
  it('allows the real names around Boston that the word list would flag', () => {
    for (const s of [
      'Cummins Hwy @ Harvard St', '400 W Cummings Pk', 'Broadway @ Dickson St', 'Cambridge Rd @ Sylvanus Wood Ln',
      'N Harvard St @ Hooker St', '455', 'Assembly', 'Middlesex Ave', 'Essex St', 'Sussex St', 'Scunthorpe',
    ]) expect(isIndecent(s), s).toBe(false);
  });
  it('isAllowlisted tells names passed only by the local list from ones never flagged', () => {
    expect(isAllowlisted('Cummins Hwy')).toBe(true);
    expect(isAllowlisted('Harvard')).toBe(false);
    expect(isAllowlisted('Assembly')).toBe(false);
    expect(isAllowlisted('sh1t')).toBe(false);
  });
  it('allows ordinary service text', () => {
    expect(isIndecent('Route 1 is detoured in both directions because of utility work on Massachusetts Ave.')).toBe(false);
    expect(isIndecent('Shuttle buses replace trains between JFK/UMass and Ashmont.')).toBe(false);
  });
});
