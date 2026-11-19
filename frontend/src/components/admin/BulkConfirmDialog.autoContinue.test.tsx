import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { BulkConfirmDialog } from './BulkConfirmDialog';
import type { BulkRequest, BulkResult } from '@/services/api';

/**
 * `autoContinue` (bulk «Aplicar (ya cargadas en POS)»): the server stops near
 * its time budget and reports the rows it did not reach; the dialog sends
 * those again by itself, shows the progress and can be stopped. A row that
 * failed for a real reason is never sent again by itself.
 */
const NOT_REACHED = 'Sin procesar: se agotó el tiempo de esta solicitud. Pulse «Reintentar fallidas» para continuar.';
const action = { name: 'apply_paid', label: 'Aplicar (ya cargadas en POS)', progressVerb: 'Aplicando' };

const res = (over: Partial<BulkResult>): BulkResult => ({
  action: 'apply_paid', requested: 0, ok: 0, failed: [], skipped: [], dry_run: false, ...over,
});
const plan = (n: number) => res({ requested: n, ok: n, dry_run: true });
const notReached = (ids: number[]) => ({
  failed: ids.map((id) => ({ id, error: NOT_REACHED })), not_reached: ids.length, not_reached_ids: ids,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const open = (execute: (b: BulkRequest) => Promise<BulkResult>, ids: number[], extra: { autoContinue?: boolean; onDone?: (r: BulkResult) => void } = {}) =>
  renderWithProviders(
    <BulkConfirmDialog open onClose={() => {}} entityLabel="recargas" ids={ids} action={action} execute={execute} {...extra} />,
  );

describe('BulkConfirmDialog autoContinue', () => {
  it('continues only the rows not reached, shows the progress and never retries a real failure', async () => {
    const second = deferred<BulkResult>();
    const execute = vi.fn<(b: BulkRequest) => Promise<BulkResult>>()
      .mockResolvedValueOnce(plan(6))
      .mockResolvedValueOnce(res({
        requested: 6, ok: 2,
        failed: [{ id: 3, error: 'Loyverse aún no muestra esta recarga.' }, ...notReached([4, 5, 6]).failed],
        not_reached: 3, not_reached_ids: [4, 5, 6],
      }))
      .mockReturnValueOnce(second.promise);
    const onDone = vi.fn();
    open(execute, [1, 2, 3, 4, 5, 6], { autoContinue: true, onDone });

    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar (ya cargadas en POS) (6)' }));
    // First answer in: 3 of 6 answered (2 applied, 1 refused), the rest on its way.
    expect(await screen.findByText(/Aplicando 3 de 6…/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Avance' })).toHaveAttribute('aria-valuenow', '3');
    expect(screen.getByRole('button', { name: 'Detener' })).toBeEnabled();
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    expect(execute.mock.calls[2][0]).toMatchObject({ action: 'apply_paid', ids: [4, 5, 6], all_matching: false, dry_run: false });
    expect(onDone).not.toHaveBeenCalled();

    second.resolve(res({ requested: 3, ok: 3 }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('5 recargas procesadas, 1 fallida.'));
    expect(execute).toHaveBeenCalledTimes(3);       // id 3 was never sent again
    const failed = screen.getByRole('list', { name: 'Filas fallidas' });
    expect(within(failed).getAllByRole('listitem')).toHaveLength(1);
    expect(failed).toHaveTextContent('#3Loyverse aún no muestra esta recarga.');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toMatchObject({ requested: 6, ok: 5 });
    expect(onDone.mock.calls[0][0].not_reached_ids).toBeUndefined();
    // The manual retry is still there for the real failure.
    expect(screen.getByRole('button', { name: 'Reintentar fallidas (1)' })).toBeInTheDocument();
  });

  it('«Detener» lets the request in flight finish and starts no other', async () => {
    const first = deferred<BulkResult>();
    const execute = vi.fn<(b: BulkRequest) => Promise<BulkResult>>()
      .mockResolvedValueOnce(plan(4))
      .mockReturnValueOnce(first.promise);
    open(execute, [1, 2, 3, 4], { autoContinue: true });

    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar (ya cargadas en POS) (4)' }));
    expect(await screen.findByText(/Aplicando 0 de 4…/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Detener' }));
    expect(screen.getByRole('button', { name: 'Deteniendo…' })).toBeDisabled();
    expect(screen.getByText('Se detendrá al terminar el lote en curso.')).toBeInTheDocument();

    first.resolve(res({ requested: 4, ok: 2, ...notReached([3, 4]) }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 recargas procesadas, 2 fallidas.'));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('list', { name: 'Filas fallidas' })).toHaveTextContent('se detuvo antes de llegar a esta fila');

    // «Reintentar fallidas» picks them up (and continues by itself again).
    execute.mockResolvedValueOnce(res({ requested: 2, ok: 2 }));
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar fallidas (2)' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 recargas procesadas.'));
    expect(execute.mock.calls[2][0]).toMatchObject({ ids: [3, 4] });
  });

  it('stops at once when only real failures come back', async () => {
    const execute = vi.fn<(b: BulkRequest) => Promise<BulkResult>>()
      .mockResolvedValueOnce(plan(2))
      .mockResolvedValueOnce(res({ requested: 2, ok: 1, failed: [{ id: 2, error: 'Su pago no está aprobado.' }] }));
    open(execute, [1, 2], { autoContinue: true });

    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar (ya cargadas en POS) (2)' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 recarga procesada, 1 fallida.'));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('sends at most 500 ids per continuation', async () => {
    const ids = Array.from({ length: 620 }, (_, i) => i + 1);
    const later = ids.slice(20);
    const execute = vi.fn<(b: BulkRequest) => Promise<BulkResult>>()
      .mockResolvedValueOnce(res({ requested: 620, ok: 620, dry_run: true }))
      .mockResolvedValueOnce(res({ requested: 620, ok: 20, ...notReached(later) }))
      .mockResolvedValueOnce(res({ requested: 500, ok: 500 }))
      .mockResolvedValueOnce(res({ requested: 100, ok: 100 }));
    open(execute, ids, { autoContinue: true });

    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar (ya cargadas en POS) (620)' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('620 recargas procesadas.'));
    expect(execute.mock.calls[2][0].ids).toEqual(later.slice(0, 500));
    expect(execute.mock.calls[3][0].ids).toEqual(later.slice(500));
  });

  it('is off by default: the rows not reached wait for «Reintentar fallidas» as before', async () => {
    const execute = vi.fn<(b: BulkRequest) => Promise<BulkResult>>()
      .mockResolvedValueOnce(plan(3))
      .mockResolvedValueOnce(res({ requested: 3, ok: 1, ...notReached([2, 3]) }));
    open(execute, [1, 2, 3]);

    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar (ya cargadas en POS) (3)' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 recarga procesada, 2 fallidas.'));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Detener' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reintentar fallidas (2)' })).toBeInTheDocument();
  });
});
