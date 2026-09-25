import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import { BulkActionBar } from './BulkActionBar';
import { BulkConfirmDialog } from './BulkConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { useRowSelection } from '@/hooks/useRowSelection';
import type { BulkActionDef, BulkRequest, BulkResult } from '@/services/api';

const ACTIONS: BulkActionDef[] = [
  { name: 'confirm', label: 'Confirmar', planVerb: 'Se confirmarán' },
  { name: 'attended', label: 'Asistió' },
  { name: 'no_show', label: 'No asistió' },
  { name: 'cancel', label: 'Cancelar', danger: true },
];

beforeEach(() => stubViewport(1280));

describe('BulkActionBar', () => {
  it('renders nothing without a selection', () => {
    const { container } = render(<BulkActionBar count={0} onClear={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count, select-all-matching, inline actions, an overflow menu, export and clear', async () => {
    const onAction = vi.fn();
    const onSelectAllMatching = vi.fn();
    const onClear = vi.fn();
    const onExport = vi.fn();
    render(
      <BulkActionBar count={2} allMatchingCount={40} onSelectAllMatching={onSelectAllMatching} actions={ACTIONS} onAction={onAction}
        onExport={onExport} onClear={onClear} itemLabel="reservas" />,
    );
    const region = screen.getByRole('region', { name: 'Acciones en lote' });
    expect(region).toHaveTextContent('2 reservas seleccionadas');
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar las 40 que coinciden' }));
    expect(onSelectAllMatching).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onAction).toHaveBeenLastCalledWith(ACTIONS[0]);
    // The fourth action lives in the overflow menu.
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Más/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cancelar' }));
    expect(onAction).toHaveBeenLastCalledWith(ACTIONS[3]);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar seleccionados' }));
    expect(onExport).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar selección' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('describes an all-matching selection', () => {
    render(<BulkActionBar count={40} allMatching allMatchingCount={40} onClear={() => {}} itemLabel="reservas" />);
    expect(screen.getByRole('region')).toHaveTextContent('40 reservas que coinciden con los filtros seleccionadas');
    expect(screen.queryByRole('button', { name: /que coinciden/ })).not.toBeInTheDocument();
  });
});

interface Row { id: number; name: string }
const ROWS: Row[] = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Beto' }, { id: 3, name: 'Caro' }];
const COLUMNS: Column<Row>[] = [{ id: 'name', header: 'Nombre', cell: (r) => r.name }];

/** A page-shaped harness: table with selection, bulk bar, confirm dialog. */
function Harness({ execute }: { execute: (b: BulkRequest) => Promise<BulkResult> }) {
  const selection = useRowSelection(ROWS.length);
  const [action, setAction] = useState<BulkActionDef | null>(null);
  return (
    <>
      <DataTable<Row>
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.name}
        selection={selection}
        bulkBar={<BulkActionBar count={selection.count} actions={[ACTIONS[0]]} onAction={setAction} onClear={selection.onClear} itemLabel="reservas" />}
      />
      <BulkConfirmDialog
        open={!!action}
        onClose={() => setAction(null)}
        action={action}
        entityLabel="reservas"
        ids={selection.ids}
        allMatching={selection.allMatching}
        execute={execute}
        onDone={() => selection.onClear()}
      />
    </>
  );
}

describe('keyboard path: select → bulk → confirm', () => {
  it('works end to end with Tab, Space and Enter only', async () => {
    const execute = vi.fn(async (body: BulkRequest): Promise<BulkResult> => ({
      action: body.action, requested: body.ids.length, ok: body.ids.length, failed: [], skipped: [], dry_run: !!body.dry_run,
    }));
    renderWithProviders(<Harness execute={execute} />);
    const user = userEvent.setup();

    // Tab: header checkbox → first row checkbox. Space selects Ana.
    await user.tab();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar todas las filas de esta página' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Ana' })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Ana' })).toBeChecked();
    // Beto too.
    await user.tab();
    await user.keyboard(' ');

    // The bulk bar appeared above the table: Shift+Tab back to its first action.
    const confirmBtn = screen.getByRole('button', { name: 'Confirmar' });
    expect(screen.getByRole('region', { name: 'Acciones en lote' })).toHaveTextContent('2 reservas seleccionadas');
    confirmBtn.focus();
    await user.keyboard('{Enter}');

    // Dialog: dry run, then the confirm button holds focus; Enter commits.
    const dialog = await screen.findByRole('dialog');
    const commit = await screen.findByRole('button', { name: 'Confirmar (2)' });
    expect(commit).toHaveFocus();
    expect(dialog).toHaveTextContent('Se confirmarán 2 reservas.');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[0][0]).toMatchObject({ action: 'confirm', ids: [1, 2], dry_run: true });
    expect(execute.mock.calls[1][0]).toMatchObject({ action: 'confirm', ids: [1, 2], dry_run: false });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 reservas procesadas.'));

    // Escape closes and focus returns to the page; the selection was cleared by onDone.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Acciones en lote' })).not.toBeInTheDocument();
  });
});
