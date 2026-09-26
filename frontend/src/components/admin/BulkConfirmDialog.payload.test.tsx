import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { BulkConfirmDialog } from './BulkConfirmDialog';
import type { BulkRequest, BulkResult } from '@/services/api';

describe('BulkConfirmDialog with a value payload and warnings (Data Ops Phase 3)', () => {
  it('plans and commits with the extra payload and lists the warnings of the dry run', async () => {
    const plan: BulkResult = {
      action: 'status', requested: 2, ok: 2, failed: [], skipped: [], dry_run: true,
      warnings: [{ id: 5, message: 'Ana (09932) tiene $80.00 de saldo en cafetería.' }],
    };
    const execute = vi.fn(async (body: BulkRequest) => (body.dry_run ? plan : { ...plan, dry_run: false, warnings: undefined }));
    renderWithProviders(
      <BulkConfirmDialog open onClose={() => {}} entityLabel="alumnos" gender="m" ids={[5, 6]} payload={{ value: 'withdrawn' }}
        action={{ name: 'status', label: 'Dar de baja', danger: true, planVerb: 'Se darán de baja' }} execute={execute} />,
    );
    expect(await screen.findByRole('list', { name: 'Avisos' })).toHaveTextContent('Ana (09932) tiene $80.00');
    expect(screen.getByRole('note')).toHaveTextContent('Atención (1)');
    expect(execute.mock.calls[0][0]).toMatchObject({ dry_run: true, payload: { value: 'withdrawn' } });
    await userEvent.click(screen.getByRole('button', { name: 'Dar de baja (2)' }));
    await waitFor(() => expect(execute).toHaveBeenLastCalledWith({ action: 'status', ids: [5, 6], all_matching: false, filters: undefined, payload: { value: 'withdrawn' }, dry_run: false }));
  });

  it('without warnings renders no notice', async () => {
    const execute = vi.fn(async (body: BulkRequest) => ({ action: 'grade', requested: 1, ok: 1, failed: [], skipped: [], dry_run: !!body.dry_run }));
    renderWithProviders(
      <BulkConfirmDialog open onClose={() => {}} entityLabel="alumnos" ids={[1]} payload={{ value: '2° Primaria' }}
        action={{ name: 'grade', label: 'Cambiar grado' }} execute={execute} />,
    );
    await screen.findByRole('button', { name: 'Cambiar grado (1)' });
    expect(screen.queryByRole('list', { name: 'Avisos' })).not.toBeInTheDocument();
  });
});
