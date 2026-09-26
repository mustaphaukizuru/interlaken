import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { BulkConfirmDialog } from './BulkConfirmDialog';
import type { BulkRequest, BulkResult } from '@/services/api';

const plan: BulkResult = {
  action: 'confirm', requested: 16, ok: 14, dry_run: true, failed: [],
  skipped: [{ id: 3, reason: 'ya está cancelada' }, { id: 4, reason: 'ya está cancelada' }],
};

describe('BulkConfirmDialog', () => {
  it('runs the dry run first and renders the plan with grouped skip reasons', async () => {
    const execute = vi.fn(async (body: BulkRequest) => (body.dry_run ? plan : { ...plan, dry_run: false }));
    renderWithProviders(
      <BulkConfirmDialog open onClose={() => {}} entityLabel="reservas" ids={Array.from({ length: 16 }, (_, i) => i + 1)}
        action={{ name: 'confirm', label: 'Confirmar', planVerb: 'Se confirmarán' }} execute={execute} />,
    );
    expect(await screen.findByText(/Se confirmarán/)).toHaveTextContent('Se confirmarán 14 reservas; 2 se omitirán.');
    expect(screen.getByRole('list', { name: 'Motivos de omisión' })).toHaveTextContent('2 porque ya está cancelada');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ action: 'confirm', dry_run: true, all_matching: false });
    expect(execute.mock.calls[0][0].ids).toHaveLength(16);
    // The confirm button takes focus once the plan is ready.
    expect(screen.getByRole('button', { name: 'Confirmar (14)' })).toHaveFocus();
  });

  it('requires a note for reverse transitions and sends notify in the payload', async () => {
    const onDone = vi.fn();
    const execute = vi.fn(async (body: BulkRequest) => (body.dry_run ? { ...plan, skipped: [] } : { ...plan, skipped: [], dry_run: false }));
    renderWithProviders(
      <BulkConfirmDialog open onClose={() => {}} entityLabel="reservas" ids={[1, 2]} onDone={onDone}
        action={{ name: 'reopen', label: 'Reabrir', requiresNote: true, notifyOption: true }} execute={execute} />,
    );
    const confirm = await screen.findByRole('button', { name: 'Reabrir (16)' });
    expect(confirm).toBeDisabled();
    expect(screen.getByLabelText('Motivo (obligatorio)')).toHaveFocus();
    await userEvent.type(screen.getByLabelText('Motivo (obligatorio)'), 'Error de captura');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Notificar a las familias' }));
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(execute.mock.calls[1][0]).toMatchObject({ dry_run: false, ids: [1, 2], payload: { note: 'Error de captura', notify: false } });
    expect(screen.getByRole('status')).toHaveTextContent('14 reservas procesadas.');
  });

  it('lists per-row failures and retries only the failed ids', async () => {
    const execute = vi
      .fn<(body: BulkRequest) => Promise<BulkResult>>()
      .mockResolvedValueOnce({ action: 'cancel', requested: 3, ok: 3, failed: [], skipped: [], dry_run: true })
      .mockResolvedValueOnce({ action: 'cancel', requested: 3, ok: 1, failed: [{ id: 2, error: 'Cupo lleno' }, { id: 3, error: 'Sin conexión con Calendar' }], skipped: [], dry_run: false })
      .mockResolvedValueOnce({ action: 'cancel', requested: 2, ok: 2, failed: [], skipped: [], dry_run: false });
    renderWithProviders(
      <BulkConfirmDialog open onClose={() => {}} entityLabel="reservas" ids={[1, 2, 3]}
        action={{ name: 'cancel', label: 'Cancelar reservas', danger: true }} execute={execute} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar reservas (3)' }));
    const failed = await screen.findByRole('list', { name: 'Filas fallidas' });
    expect(failed).toHaveTextContent('#2Cupo lleno');
    expect(failed).toHaveTextContent('#3Sin conexión con Calendar');
    expect(screen.getByRole('status')).toHaveTextContent('1 reservas procesadas, 2 fallidas.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar fallidas (2)' }));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    expect(execute.mock.calls[2][0]).toMatchObject({ ids: [2, 3], dry_run: false, all_matching: false });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 reservas procesadas.'));
    expect(screen.queryByRole('list', { name: 'Filas fallidas' })).not.toBeInTheDocument();
  });

  it('shows the API message when the dry run fails and lets the person retry', async () => {
    const execute = vi.fn<(body: BulkRequest) => Promise<BulkResult>>()
      .mockRejectedValueOnce({ response: { status: 413, data: { detail: 'Acote los filtros: el límite es 2000 filas.' } } })
      .mockResolvedValueOnce({ action: 'confirm', requested: 5, ok: 5, failed: [], skipped: [], dry_run: true });
    renderWithProviders(
      <BulkConfirmDialog open onClose={() => {}} entityLabel="reservas" ids={[]} allMatching filters={{ status: 'pending' }}
        action={{ name: 'confirm', label: 'Confirmar' }} execute={execute} />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Acote los filtros: el límite es 2000 filas.');
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByRole('button', { name: 'Confirmar (5)' })).toBeInTheDocument();
    expect(execute.mock.calls[0][0]).toMatchObject({ all_matching: true, filters: { status: 'pending' }, ids: [] });
  });

  it('renders entity-specific plan lines (renderPlan) under the dry-run plan', async () => {
    const execute = vi.fn(async () => ({ ...plan, skipped: [], total: '300.00' }) as BulkResult);
    renderWithProviders(
      <BulkConfirmDialog open onClose={() => {}} entityLabel="depósitos" gender="m" ids={[1]} execute={execute}
        action={{ name: 'apply', label: 'Aplicar', planVerb: 'Se aplicarán' }}
        renderPlan={(p) => <p>Total: {(p as BulkResult & { total?: string }).total}</p>} />,
    );
    expect(await screen.findByText('Total: 300.00')).toBeInTheDocument();
  });
});
