import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/renderWithProviders';
import { emptyTable, formatCell, isMultiCell, normalizeTable, parseTsv, pasteBlock, TABLE_LIMITS, type TableValue } from './table';
import { TableBlock } from './TableBlock';
import { BLOCKS } from './registry';
import { newBlock } from '../editor/helpers';

vi.mock('@/services/api', () => ({ contentApi: { getSettings: vi.fn(() => new Promise(() => {})) } }));

describe('TSV paste', () => {
  it('reads Excel and Google Sheets cells, quotes and CRLF included', () => {
    expect(parseTsv('Nivel\tCuota\r\nPrimaria\t6450\r\n')).toEqual([['Nivel', 'Cuota'], ['Primaria', '6450']]);
    expect(parseTsv('"Dos\nlíneas"\t"con ""comillas"""\nb\t')).toEqual([['Dos\nlíneas', 'con "comillas"'], ['b', '']]);
    expect(isMultiCell('6450')).toBe(false);
    expect(isMultiCell('6450\n')).toBe(false);
    expect(isMultiCell('a\tb')).toBe(true);
  });

  it('fills from the focused cell, adds rows and columns, keeps the limits', () => {
    const start: TableValue = { columns: [{ label: 'A' }], rows: [['x']], highlight: null };
    const { table, dropped } = pasteBlock(start, { row: 0, col: 0 }, [['1', '2'], ['3', '4']]);
    expect(table.columns.map((c) => c.label)).toEqual(['A', '']);
    expect(table.rows).toEqual([['1', '2'], ['3', '4']]);
    expect(dropped).toBe(0);
    const headers = pasteBlock(start, { row: -1, col: 0 }, [['Nivel', 'Cuota'], ['Primaria', '6450']]).table;
    expect(headers.columns.map((c) => c.label)).toEqual(['Nivel', 'Cuota']);
    expect(headers.rows).toEqual([['Primaria', '6450']]);
    const wide = pasteBlock(start, { row: 0, col: 0 }, [Array.from({ length: 10 }, (_, i) => String(i))]);
    expect(wide.table.columns).toHaveLength(TABLE_LIMITS.columns);
    expect(wide.dropped).toBe(2);
    const tall = pasteBlock(start, { row: 0, col: 0 }, Array.from({ length: 65 }, () => ['x']));
    expect(tall.table.rows).toHaveLength(TABLE_LIMITS.rows);
    expect(tall.dropped).toBe(5);
  });
});

describe('cells', () => {
  it('formats money, numbers and percentages; text stays as typed', () => {
    expect(formatCell('6450', 'money')).toBe('$6,450.00');
    expect(formatCell('$6,450.5', 'money')).toBe('$6,450.50');
    expect(formatCell('Sin costo', 'money')).toBe('Sin costo');
    expect(formatCell('1250', 'number')).toBe('1,250');
    expect(formatCell('5', 'percent')).toBe('5%');
    expect(formatCell('5 %', 'percent')).toBe('5%');
    expect(formatCell('6450', 'text')).toBe('6450');
  });

  it('normalises any stored value to the limits', () => {
    const t = normalizeTable({ columns: [{ label: 'A', format: 'html', align: 'x' }, { label: 7 }], rows: [['a'], 'x', ['b', 'c', 'd']], highlight: 9 });
    expect(t.columns).toEqual([{ label: 'A', format: 'text', align: undefined }, { label: '7', format: 'text', align: undefined }]);
    expect(t.rows).toEqual([['a', ''], ['', ''], ['b', 'c']]);
    expect(t.highlight).toBeNull();
    expect(normalizeTable(undefined)).toEqual({ columns: [], rows: [], highlight: null });
  });

  it('a new block starts with the table defaults', () => {
    const spec = BLOCKS.find((b) => b.type === 'table')!;
    expect(spec.fields.find((f) => f.key === 'table')).toMatchObject({ kind: 'table', required: true, limits: TABLE_LIMITS });
    const block = newBlock('table');
    expect(block.props.table).toEqual(emptyTable());
    expect(block.props.card).toBe(true);
  });
});

const PRICES: TableValue = {
  columns: [{ label: 'Nivel' }, { label: 'Cuota', format: 'money' }, { label: 'Descuento', format: 'percent' }],
  rows: [['Primaria', '6450', '5'], ['Secundaria', '6990', '']],
  highlight: 1,
};

describe('TableBlock', () => {
  it('is a real table: caption, column and row headers, formatted figures', () => {
    renderWithProviders(<TableBlock title="Cuotas {{ciclo}}" table={PRICES} notes={'Nota uno\n\nNota dos'} card label="Mensual" />);
    const table = screen.getByRole('table', { name: /^Cuotas \d{4}.\d{4}$/ });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Nivel', 'Cuota', 'Descuento']);
    expect(within(table).getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['Primaria', 'Secundaria']);
    expect(within(table).getByText('$6,450.00')).toBeInTheDocument();
    expect(within(table).getByText('5%')).toBeInTheDocument();
    expect(within(table).getByText('Secundaria').closest('tr')).toHaveClass('bg-green-50');
    expect(screen.getByRole('heading', { level: 2, name: /^Cuotas/ })).toBeInTheDocument();
    expect(screen.getByText('Mensual')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Nota uno', 'Nota dos']);
  });

  it('never renders HTML from a cell', () => {
    const { container } = renderWithProviders(<TableBlock title="X" table={{ columns: [{ label: '<b>A</b>' }], rows: [['<img src=x onerror=alert(1)>']] }} card={false} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('on a narrow screen it scrolls inside its box, says so, and the keyboard can reach it', () => {
    const RO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
    const sw = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(600);
    const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
    try {
      renderWithProviders(<TableBlock title="Cuotas" table={PRICES} />);
      expect(screen.getByRole('region', { name: 'Cuotas' })).toHaveAttribute('tabindex', '0');
      expect(screen.getByText(/Deslice la tabla/)).toBeInTheDocument();
    } finally {
      sw.mockRestore(); cw.mockRestore(); globalThis.ResizeObserver = RO;
    }
  });

  it('passes axe as a card and as a plain table', async () => {
    const a = renderWithProviders(<TableBlock title="Cuotas" intro="Por nivel." table={PRICES} card />);
    expect((await axe(a.container)).violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
    a.unmount();
    const b = renderWithProviders(<TableBlock title="" table={PRICES} card={false} />);
    expect(screen.getByRole('table', { name: 'Tabla' })).toBeInTheDocument();
    expect((await axe(b.container)).violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
  });
});
