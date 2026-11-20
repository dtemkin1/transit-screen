export interface ColumnSize {
  /** Inner height, px, unrounded. */
  height: number;
  /** Gap between the column's children (its `row-gap`), px. */
  gap: number;
}

/** Reports `node`'s height and row gap now and whenever it resizes. */
export function measure(node: HTMLElement, report: (size: ColumnSize) => void) {
  let fn = report;
  const check = () =>
    fn({ height: node.getBoundingClientRect().height, gap: parseFloat(getComputedStyle(node).rowGap) || 0 });
  const resize = new ResizeObserver(check);
  resize.observe(node);
  return {
    update(next: (size: ColumnSize) => void) {
      fn = next;
    },
    destroy() {
      resize.disconnect();
    },
  };
}
