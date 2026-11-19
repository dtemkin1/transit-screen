/**
 * The font size that fits one line `naturalPx` wide (at `fullPx`) into `availablePx`: the full size
 * if it fits, else scaled down to fit, but never below `minPx`; at that floor the text wraps instead.
 */
export function fitSize(naturalPx: number, availablePx: number, fullPx: number, minPx: number): { px: number; wrap: boolean } {
  if (naturalPx <= availablePx) return { px: fullPx, wrap: false };
  const px = Math.floor(fullPx * (availablePx / naturalPx) * 10) / 10;
  return px >= minPx ? { px, wrap: false } : { px: minPx, wrap: true };
}

/**
 * Svelte action for text that must never be cut (the building name): shrinks it to fit its box, down
 * to the parent's text size, and below that lets it wrap between words. The box must not size to it.
 */
export function shrinkToFit(node: HTMLElement, text: string) {
  let current = text;
  const run = () => {
    node.textContent = current;
    node.style.fontSize = '';
    node.style.whiteSpace = '';
    if (node.clientWidth === 0) return;
    const full = parseFloat(getComputedStyle(node).fontSize);
    const min = parseFloat(getComputedStyle(node.parentElement ?? node).fontSize);
    let { px, wrap } = fitSize(node.scrollWidth, node.clientWidth, full, min);
    node.style.fontSize = `${px}px`;
    // Width isn't exactly proportional to size (kerning, rounding): step down until it fits.
    while (!wrap && node.scrollWidth > node.clientWidth && px > min) {
      px = Math.max(min, px - 0.5);
      node.style.fontSize = `${px}px`;
    }
    if (wrap || node.scrollWidth > node.clientWidth) node.style.whiteSpace = 'normal';
  };

  run();
  const observer = new ResizeObserver(run);
  observer.observe(node);
  document.fonts?.addEventListener('loadingdone', run);
  return {
    update(next: string) {
      current = next;
      run();
    },
    destroy() {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', run);
    },
  };
}
