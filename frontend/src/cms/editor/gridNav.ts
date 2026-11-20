/**
 * Spreadsheet keys for a grid of inputs (the «Tabla» editor and the
 * «Costos y precios» console). Each editable cell carries `data-row` and
 * `data-col`; the grid's container calls `gridKeyDown` from its onKeyDown.
 *
 *   Tab / Shift+Tab     next / previous cell (the browser's own order)
 *   Enter / Shift+Enter cell below / above
 *   ↑ ↓                 cell above / below (in a textarea: from its first / last line)
 *   ← →                 previous / next cell when the caret is at the edge of the text
 *   Alt+↑ / Alt+↓       move the whole row up / down (keyboard reorder)
 */
import type { KeyboardEvent } from 'react';

type Editable = HTMLInputElement | HTMLTextAreaElement;

const cellOf = (el: EventTarget | null) => {
  if (!(el instanceof HTMLElement)) return null;
  const row = Number(el.dataset.row);
  const col = Number(el.dataset.col);
  return Number.isInteger(row) && Number.isInteger(col) ? { el, row, col } : null;
};

/** Focuses the cell at (row, col) of `root`, or the nearest column of that row. */
export function focusCell(root: HTMLElement, row: number, col: number): boolean {
  const exact = root.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
  const target = exact ?? [...root.querySelectorAll<HTMLElement>(`[data-row="${row}"][data-col]`)]
    .sort((a, b) => Math.abs(Number(a.dataset.col) - col) - Math.abs(Number(b.dataset.col) - col))[0];
  if (!target) return false;
  target.focus();
  if (target instanceof HTMLInputElement && target.type === 'text') target.select();
  return true;
}

const isText = (el: HTMLElement): el is Editable =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', ''].includes(el.type));

export function gridKeyDown(e: KeyboardEvent<HTMLElement>, opts: { onMoveRow?: (row: number, delta: -1 | 1) => void } = {}) {
  const cell = cellOf(e.target);
  if (!cell || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
  const root = e.currentTarget;
  const { el, row, col } = cell;
  const go = (r: number, c: number) => { if (focusCell(root, r, c)) e.preventDefault(); };

  if (e.altKey) {
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && opts.onMoveRow) {
      e.preventDefault();
      const delta = e.key === 'ArrowUp' ? -1 : 1;
      opts.onMoveRow(row, delta);
      // The row re-renders at its new index: keep the caret in the same column.
      requestAnimationFrame(() => focusCell(root, row + delta, col));
    }
    return;
  }
  const text = isText(el) ? el : null;
  const start = text?.selectionStart ?? 0;
  const end = text?.selectionEnd ?? 0;
  const length = text?.value.length ?? 0;
  const multiline = el instanceof HTMLTextAreaElement;

  switch (e.key) {
    case 'Enter':
      if (el instanceof HTMLButtonElement || (el instanceof HTMLInputElement && el.type === 'checkbox')) return;
      go(e.shiftKey ? row - 1 : row + 1, col);
      return;
    case 'ArrowUp':
      if (multiline && text && text.value.slice(0, start).includes('\n')) return;
      go(row - 1, col);
      return;
    case 'ArrowDown':
      if (multiline && text && text.value.slice(end).includes('\n')) return;
      go(row + 1, col);
      return;
    case 'ArrowLeft':
      if (text && !(start === 0 && end === 0)) return;
      go(row, col - 1);
      return;
    case 'ArrowRight':
      if (text && !(start === length && end === length)) return;
      go(row, col + 1);
      return;
    default:
  }
}
