import { isIndecent } from '../util/decency';

/**
 * A run of text with an optional class, so one line can mix weights ("Spring Hill" + " via Union Sq").
 * `keep` text is never split ("2 min walk"): the other text is cut first, and it goes only as a whole.
 */
export interface Segment { text: string; cls?: string; keep?: boolean }

const ELLIPSIS = '…';
// Left dangling at the end of a cut ("Union Sq &…", "Tech Shuttle to…"), these read as noise.
const TRAILING = /(?:[\s,;:&@/\-–.]+|\s+(?:to|via|at|opp|and|of))+$/i;
// Each word with the space before it; the last also keeps any space after it (". " then "Vassar").
const WORDS = /\s*\S+(?:\s+$)?/g;

const textOf = (segs: Segment[]) => segs.map((s) => s.text).join('');
const wordsOf = (s: Segment, keepWhole: boolean) => (s.keep && !keepWhole ? [s.text] : s.text.match(WORDS) ?? []);

/**
 * Ends `out` with "…", dropping a dangling "&" or "to" from the cut text (never from `keep` text).
 * With no cut text left to end, adds a bare "…" only if `placeholder`.
 */
function ellipsis(out: Segment[], placeholder: boolean): Segment[] {
  while (out.length > 0 && !out[out.length - 1].keep) {
    const last = out[out.length - 1];
    const text = last.text.replace(TRAILING, '');
    if (text) {
      out[out.length - 1] = { ...last, text: text + ELLIPSIS };
      return out;
    }
    out.pop();
  }
  if (placeholder) out.push({ text: ELLIPSIS });
  return out;
}

/**
 * The first `n` words, then "…". With `keepWhole`, `keep` segments are always shown in full and only
 * the other words count; without it, each `keep` segment counts as one word.
 */
function cut(segs: Segment[], n: number, keepWhole: boolean): Segment[] {
  const out: Segment[] = [];
  let left = n;
  let done = false;
  for (const s of segs) {
    if (s.keep && keepWhole) {
      out.push(s);
      continue;
    }
    if (done) continue;
    const words = s.keep ? [s.text] : (s.text.match(WORDS) ?? []);
    const kept = words.slice(0, left);
    left -= kept.length;
    if (kept.length === words.length) {
      out.push(s);
      continue;
    }
    if (kept.length > 0) out.push({ ...s, text: kept.join('') });
    // When the cut leaves only `keep` text, it shows alone ("3 min walk"), not after a bare "…".
    ellipsis(out, !keepWhole);
    // Later `keep` text still shows; later words don't.
    done = true;
  }
  // Text dropped from the front leaves the next part's separator leading (", 3 min walk").
  if (done && out.length > 0) out[0] = { ...out[0], text: out[0].text.replace(/^[\s,;:.]+/, '') };
  return out;
}

/** The most words (up to `max`) whose cut fits and doesn't read as profane when the full text doesn't. */
function longest(max: number, make: (n: number) => Segment[], fits: (segs: Segment[]) => boolean, clean: boolean) {
  // Even the shortest cut must show something.
  if (max < 0 || !textOf(make(0)).trim() || !fits(make(0))) return null;
  // Fit is monotonic in word count, so binary search for the most words that fit.
  let lo = 0;
  let hi = max;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(make(mid))) lo = mid; else hi = mid - 1;
  }
  for (let n = lo; n >= 0; n--) {
    const candidate = make(n);
    if (!clean || !isIndecent(textOf(candidate))) return candidate;
  }
  return null;
}

/**
 * The text as given if it fits, else the most whole words that fit, then "…". Never cuts inside a
 * word, and never stops where the shortened text reads as profane when the full text doesn't.
 */
export function fitWords(segs: Segment[], fits: (segs: Segment[]) => boolean): Segment[] {
  if (fits(segs)) return segs;
  const clean = !isIndecent(textOf(segs));
  const count = (keepWhole: boolean) => segs.reduce((n, s) => n + (s.keep && keepWhole ? 0 : wordsOf(s, keepWhole).length), 0);
  return longest(count(true) - 1, (n) => cut(segs, n, true), fits, clean)
    ?? longest(count(false) - 1, (n) => cut(segs, n, false), fits, clean)
    ?? [{ text: ELLIPSIS }];
}

/** The first option that fits whole; failing that, the last option cut to fit. */
export function fitOptions(options: Segment[][], fits: (segs: Segment[]) => boolean): Segment[] {
  for (const option of options.slice(0, -1)) if (fits(option)) return option;
  return fitWords(options[options.length - 1], fits);
}

/**
 * Svelte action: renders text into the element, cut at a word boundary when it overflows (one line,
 * or the lines a line-clamp allows). Pass segments, or a list of options in order of preference.
 * When cut, the full text stays available to screen readers and as a tooltip. The element must clip.
 */
export function fit(node: HTMLElement, text: Segment[] | Segment[][]) {
  let options = toOptions(text);
  const nodesOf = (segs: Segment[]) => segs.map((s) => {
    if (!s.cls) return document.createTextNode(s.text);
    const span = document.createElement('span');
    span.className = s.cls;
    span.textContent = s.text;
    return span;
  });
  const render = (segs: Segment[]) => node.replaceChildren(...nodesOf(segs));
  const fits = (segs: Segment[]) => {
    render(segs);
    if (node.scrollWidth > node.clientWidth + 1) return false;
    // Height counts only for wrapping text (a line-clamp), since a row can squeeze a one-line box;
    // and since tall glyphs poke past a box, only a whole extra line is too tall.
    const style = getComputedStyle(node);
    if (style.whiteSpace.startsWith('nowrap')) return true;
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    return node.scrollHeight < node.clientHeight + line / 2;
  };
  const run = () => {
    const full = options[0];
    // Not laid out yet: show everything, and fit once the observer reports a size.
    const shown = node.clientWidth === 0 ? full : fitOptions(options, fits);
    if (shown === full) {
      render(full);
      node.removeAttribute('title');
      return;
    }
    // Screen readers get the full text; the shortened copy is for the eye only.
    const visible = document.createElement('span');
    visible.setAttribute('aria-hidden', 'true');
    visible.append(...nodesOf(shown));
    const spoken = document.createElement('span');
    spoken.className = 'visually-hidden';
    spoken.textContent = textOf(full);
    node.replaceChildren(visible, spoken);
    node.title = textOf(full);
  };

  run();
  const observer = new ResizeObserver(run);
  observer.observe(node);
  document.fonts?.addEventListener('loadingdone', run);
  return {
    update(next: Segment[] | Segment[][]) {
      options = toOptions(next);
      run();
    },
    destroy() {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', run);
    },
  };
}

function toOptions(text: Segment[] | Segment[][]): Segment[][] {
  return Array.isArray(text[0]) ? (text as Segment[][]) : [text as Segment[]];
}
