import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { lastOpenedScope, rememberOpened } from '@/lib/lastOpened';
import { stubViewport } from '@/test/viewport';
import { REVEAL_DELAY_MS, revealIfHidden } from './useReturnHighlight';

type Rect = { top: number; bottom: number; height?: number; width?: number };
const box = ({ top, bottom, height = bottom - top, width = 400 }: Rect) =>
  ({ top, bottom, height, width, left: 0, right: width, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

/** Gives `el` a fixed box (jsdom lays nothing out). */
function place(el: Element, rect: Rect) {
  el.getBoundingClientRect = () => box(rect);
}

describe('revealIfHidden', () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
  });
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
    document.body.innerHTML = '';
  });

  /** A scroll box (the console column) holding a table with a sticky header. */
  function setup() {
    document.body.innerHTML = `
      <div id="column" style="overflow-y: auto">
        <table><thead><tr><th>Nombre</th></tr></thead><tbody><tr id="row"><td>Ana</td></tr></tbody></table>
      </div>`;
    const column = document.getElementById('column')!;
    const row = document.getElementById('row')!;
    const head = document.querySelector('thead')!;
    place(column, { top: 100, bottom: 700 });
    place(head, { top: 50, bottom: 90 });
    return { column, row, head };
  }

  it('leaves a row that is already in view where it is', () => {
    const { row } = setup();
    place(row, { top: 300, bottom: 340 });
    revealIfHidden(row);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('centres a row below or above the visible part of its scroll box, without smooth scrolling', () => {
    const { row } = setup();
    place(row, { top: 900, bottom: 940 });
    revealIfHidden(row);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center', inline: 'nearest', behavior: 'auto' });

    place(row, { top: 20, bottom: 60 });
    revealIfHidden(row);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('counts a row half cut by the bottom edge as hidden', () => {
    const { row } = setup();
    place(row, { top: 680, bottom: 720 });
    revealIfHidden(row);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('counts a row under the stuck table header as hidden', () => {
    const { row, head } = setup();
    place(head, { top: 100, bottom: 140 });
    place(row, { top: 110, bottom: 150 });
    revealIfHidden(row);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an element without a box (a hidden tab)', () => {
    const { row } = setup();
    place(row, { top: 0, bottom: 0, width: 0 });
    revealIfHidden(row);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('DataTable · bringing the remembered row into view', () => {
  interface Row { id: number; name: string }
  const ROWS: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Alumno ${i + 1}` }));
  const COLUMNS: Column<Row>[] = [{ id: 'name', header: 'Nombre', cell: (r) => r.name }];
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubViewport(1280);
    sessionStorage.clear();
    vi.useFakeTimers();
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (Element.prototype as Partial<Element>).scrollIntoView;
    sessionStorage.clear();
  });

  it('waits for the scroll restore, then scrolls only a row that is still out of sight', () => {
    rememberOpened(lastOpenedScope('t-far'), 28);
    render(<DataTable<Row> tableId="t-far" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    const row = screen.getByText('Alumno 28').closest('tr')!;
    expect(row).toHaveAttribute('data-last-opened', 'true');
    place(row, { top: 2000, bottom: 2040 });

    act(() => { vi.advanceTimersByTime(REVEAL_DELAY_MS - 1); });
    expect(scrollIntoView).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(row);
  });

  it('does not move a remembered row the restore already shows', () => {
    rememberOpened(lastOpenedScope('t-near'), 2);
    render(<DataTable<Row> tableId="t-near" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    place(screen.getByText('Alumno 2').closest('tr')!, { top: 200, bottom: 240 });
    act(() => { vi.advanceTimersByTime(REVEAL_DELAY_MS); });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
