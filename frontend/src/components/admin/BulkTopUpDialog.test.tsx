import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  cafeteriaApi: { bulkTopUp: vi.fn() },
}));

vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: t };
});

import toast from 'react-hot-toast';
import { BulkTopUpDialog } from './BulkTopUpDialog';
import { cafeteriaApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const bulkTopUp = vi.mocked(cafeteriaApi.bulkTopUp);
const ok = (data: unknown) => ({ data }) as never;

describe('BulkTopUpDialog', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('applies with one batch id and resumes until nothing remains', async () => {
    const user = userEvent.setup();
    bulkTopUp
      .mockResolvedValueOnce(ok({ count: 3, total: '150.00', students: [] }))
      .mockResolvedValueOnce(ok({ credited: 2, skipped: 0, remaining: 1, total: '100.00', batch_id: 'x', failed: [] }))
      .mockResolvedValueOnce(ok({ credited: 1, skipped: 2, remaining: 0, total: '50.00', batch_id: 'x', failed: [] }));
    renderWithProviders(<BulkTopUpDialog />);

    await user.click(screen.getByRole('button', { name: /recarga masiva/i }));
    await user.type(screen.getByLabelText(/monto por alumno/i), '50');
    await user.type(screen.getByLabelText(/motivo/i), 'Beca');
    await user.selectOptions(screen.getByLabelText(/grado/i), screen.getAllByRole('option')[1]);
    await user.click(screen.getByRole('button', { name: /ver a quién aplica/i }));
    await user.click(await screen.findByRole('button', { name: /acreditar a 3 alumnos/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(bulkTopUp).toHaveBeenCalledTimes(3);
    const first = bulkTopUp.mock.calls[1][0];
    const second = bulkTopUp.mock.calls[2][0];
    expect(first.batch_id).toBeTruthy();
    expect(second.batch_id).toBe(first.batch_id);
    expect(first.preview).toBeUndefined();
    expect(vi.mocked(toast.success).mock.calls[0][0]).toMatch(/^3 monederos/);
  });
});
