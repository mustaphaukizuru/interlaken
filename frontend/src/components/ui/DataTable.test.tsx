import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inbox } from 'lucide-react';
import { DataTable, type Column, type DataTableSelection } from './DataTable';
import type { SortState } from './SortableTh';
import { stubViewport } from '@/test/viewport';
import { prefsKey } from '@/hooks/useTablePrefs';

interface Row { id: number; name: string; amount: number }

const ROWS: Row[] = [
  { id: 1, name: 'Ana', amount: 10 },
  { id: 2, name: 'Beto', amount: 20 },
];

const COLUMNS: Column<Row>[] = [
  { id: 'name', header: 'Nombre', sortKey: 'name', hideable: false, cell: (r) => r.name },
  { id: 'amount', header: 'Monto', sortKey: 'amount', align: 'right', cell: (r) => r.amount },
  { id: 'notes', header: 'Notas', defaultHidden: true, cell: () => 'n' },
];

const noSort: SortState = { key: '', dir: 'desc' };

beforeEach(() => stubViewport(1280));

describe('DataTable v2', () => {
  it('renders headers, cells with data-label, and hides defaultHidden columns', () => {
    render(<DataTable<Row> columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(screen.getByRole('columnheader', { name: 'Nombre' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Notas' })).not.toBeInTheDocument();
    const cell = screen.getByText('Ana').closest('td');
    expect(cell).toHaveAttribute('data-label', 'Nombre');
    expect(screen.getByText('20').closest('td')).toHaveClass('num');
  });

  it('cycles sort desc → asc → clear on the header button and exposes aria-sort', async () => {
    const onSort = vi.fn();
    const { rerender } = render(<DataTable<Row> columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} sort={noSort} onSort={onSort} />);
    await userEvent.click(screen.getByRole('button', { name: 'Monto' }));
    expect(onSort).toHaveBeenLastCalledWith({ key: 'amount', dir: 'desc' });

    rerender(<DataTable<Row> columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} sort={{ key: 'amount', dir: 'desc' }} onSort={onSort} />);
    expect(screen.getByRole('columnheader', { name: 'Monto' })).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(screen.getByRole('button', { name: 'Monto' }));
    expect(onSort).toHaveBeenLastCalledWith({ key: 'amount', dir: 'asc' });

    rerender(<DataTable<Row> columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} sort={{ key: 'amount', dir: 'asc' }} onSort={onSort} />);
    expect(screen.getByRole('columnheader', { name: 'Monto' })).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(screen.getByRole('button', { name: 'Monto' }));
    expect(onSort).toHaveBeenLastCalledWith({ key: '', dir: 'desc' });
    expect(screen.getByRole('columnheader', { name: 'Nombre' })).toHaveAttribute('aria-sort', 'none');
  });

  it('selects rows and the whole page, marks aria-selected, and offers select-all-matching', async () => {
    const onChange = vi.fn();
    const onSelectAllMatching = vi.fn();
    const onClear = vi.fn();
    const sel = (selected: Set<number>, allMatching = false): DataTableSelection => ({
      selected, onChange, allMatchingCount: 57, allMatching, onSelectAllMatching, onClear,
    });
    const { rerender } = render(
      <DataTable<Row> columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} rowLabel={(r) => `pago ${r.id}`} selection={sel(new Set())} />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar pago 1' }));
    expect(onChange).toHaveBeenLastCalledWith(new Set([1]));

    rerender(<DataTable<Row> columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} rowLabel={(r) => `pago ${r.id}`} selection={sel(new Set([1]))} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    expect(rows[1]).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByText(/Seleccionar las 57 que coinciden/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todas las filas de esta página' }));
    expect(onChange).toHaveBeenLastCalledWith(new Set([1, 2]));

    rerender(<DataTable<Row> columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} rowLabel={(r) => `pago ${r.id}`} selection={sel(new Set([1, 2]))} />);
    await userEvent.click(screen.getByRole('button', { name: /Seleccionar las 57 que coinciden/ }));
    expect(onSelectAllMatching).toHaveBeenCalled();

    rerender(<DataTable<Row> columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} rowLabel={(r) => `pago ${r.id}`} selection={sel(new Set([1, 2]), true)} />);
    expect(screen.getByRole('status')).toHaveTextContent('Las 57 filas que coinciden con los filtros están seleccionadas.');
    expect(screen.getByRole('checkbox', { name: 'Seleccionar pago 2' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar selección' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('persists column visibility and density per tableId through the controls', async () => {
    const view = () => <DataTable<Row> tableId="t1" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} columnControls />;
    const { unmount } = render(view());
    await userEvent.click(screen.getByRole('button', { name: /Columnas/ }));
    const monto = screen.getByRole('checkbox', { name: 'Monto' });
    expect(monto).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Nombre' })).toBeDisabled();
    await userEvent.click(monto);
    expect(screen.queryByRole('columnheader', { name: 'Monto' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Notas' }));
    expect(screen.getByRole('columnheader', { name: 'Notas' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Compacta' }));
    expect(screen.getByRole('table')).toHaveClass('admin-table--dense');
    expect(screen.getByRole('button', { name: 'Vista compacta' })).toHaveAttribute('aria-pressed', 'true');

    expect(JSON.parse(localStorage.getItem(prefsKey('t1')) || 'null')).toEqual({ hidden: ['amount'], density: 'dense', widths: {} });

    unmount();
    render(view());
    expect(screen.queryByRole('columnheader', { name: 'Monto' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Notas' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveClass('admin-table--dense');

    await userEvent.click(screen.getByRole('button', { name: /Columnas/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer' }));
    expect(screen.getByRole('columnheader', { name: 'Monto' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Notas' })).not.toBeInTheDocument();
    expect(localStorage.getItem(prefsKey('t1'))).toBeNull();
  });

  it('renders resize handles on desktop only and persists a width on drag', () => {
    const { unmount } = render(<DataTable<Row> tableId="t2" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} resizable />);
    const handle = screen.getByTestId('resize-name');
    expect(handle).toHaveAttribute('aria-hidden', 'true');
    unmount();

    stubViewport(375);
    render(<DataTable<Row> tableId="t2" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} resizable />);
    expect(screen.queryByTestId('resize-name')).not.toBeInTheDocument();
  });

  it('under 768 px renders cards: data-label everywhere, the checkbox and the row actions inside each card', async () => {
    stubViewport(375);
    const onAct = vi.fn();
    render(
      <DataTable<Row>
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.name}
        selection={{ selected: new Set(), onChange: vi.fn() }}
        rowActions={(r) => <button type="button" onClick={() => onAct(r.id)}>Editar</button>}
        resizable
      />,
    );
    const wrap = screen.getByRole('table').parentElement;
    expect(wrap).toHaveAttribute('data-layout', 'cards');
    const firstRow = screen.getAllByRole('row')[1];
    const cells = within(firstRow).getAllByRole('cell');
    expect(cells[0]).toHaveAttribute('data-label', 'Seleccionar');
    expect(within(cells[0]).getByRole('checkbox', { name: 'Seleccionar Ana' })).toBeInTheDocument();
    expect(cells[cells.length - 1]).toHaveAttribute('data-label', 'Acciones');
    // Narrow widths collapse the actions into an overflow menu.
    await userEvent.click(within(firstRow).getByRole('button', { name: 'Acciones de Ana' }));
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(onAct).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId('resize-name')).not.toBeInTheDocument();
  });

  it('renders row actions inline on wide screens', () => {
    render(<DataTable<Row> columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} rowActions={() => <button type="button">Editar</button>} />);
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Acciones de/ })).not.toBeInTheDocument();
  });

  it('keeps the toolbar visible in the empty state and supports row click by pointer and keyboard', async () => {
    const onRowClick = vi.fn();
    const { rerender } = render(
      <DataTable<Row> columns={COLUMNS} rows={[]} rowKey={(r) => r.id} toolbar={<input aria-label="Buscar" />} empty={{ icon: Inbox, title: 'Nada' }} />,
    );
    expect(screen.getByRole('textbox', { name: 'Buscar' })).toBeInTheDocument();
    expect(screen.getByText('Nada')).toBeInTheDocument();

    rerender(<DataTable<Row> columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    await userEvent.click(screen.getByText('Beto'));
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[1]);
    const row = screen.getAllByRole('row')[1];
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[0]);
  });

  it('shows the error state with retry and a skeleton while loading', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<DataTable<Row> columns={COLUMNS} rows={undefined} rowKey={(r) => r.id} isError onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(onRetry).toHaveBeenCalled();
    rerender(<DataTable<Row> columns={COLUMNS} rows={undefined} rowKey={(r) => r.id} isLoading />);
    expect(document.querySelector('.skeleton')).not.toBeNull();
  });
});
