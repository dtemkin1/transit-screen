import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

// Real names the English list flags, so alerts naming them aren't hidden. names.json (published by
// each deploy, from scripts/scan-names.ts) lists any feed name still flagged; add those here.
const LOCAL_NAMES = ['cummings', 'cummins', 'dickson', 'sylvanus', 'hooker st', 'hooker street', '455'];

const dataset = englishDataset.build();
const listOnly = (): RegExpMatcher => new RegExpMatcher({ ...dataset, ...englishRecommendedTransformers });
const matcher = new RegExpMatcher({
  ...dataset,
  whitelistedTerms: [...(dataset.whitelistedTerms ?? []), ...LOCAL_NAMES],
  ...englishRecommendedTransformers,
});

/** True when text contains profanity, including look-alike characters ("sh1t", "f*ck") and stretched letters. */
export function isIndecent(text: string): boolean {
  return matcher.hasMatch(text);
}

let withoutLocalNames: RegExpMatcher | undefined;
/** True when only LOCAL_NAMES keeps text from being flagged (for the name report; built on first use). */
export function isAllowlisted(text: string): boolean {
  withoutLocalNames ??= listOnly();
  return withoutLocalNames.hasMatch(text) && !matcher.hasMatch(text);
}
