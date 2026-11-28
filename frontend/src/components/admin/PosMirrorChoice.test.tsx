import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/cafeteriaAdmin', () => ({
  cafeteriaAdminApi: {
    linkTopUpToPos: vi.fn(),
    applyPaidTopUp: vi.fn(),
    applyOfficeTopUp: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { PosMirrorChoice, mirrorFromError, type PosMirrorAsk } from './PosMirrorChoice';
import { cafeteriaAdminApi } from '@/services/cafeteriaAdmin';
import { renderWithProviders } from '@/test/renderWithProviders';

const ask = (kind: PosMirrorAsk['kind']): PosMirrorAsk => ({
  topupId: 41,
  studentName: 'Ana Inventada',
  amount: '200.00',
  kind,
  mirror: { pos_transaction: 9, pos_date: '2026-11-28T09:15:00-06:00', pos_amount: '200.00' },
});

describe('PosMirrorChoice (cafeteria.hand_loads)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says what Loyverse already has and links on «Es esta misma» (no money moves)', async () => {
    vi.mocked(cafeteriaAdminApi.linkTopUpToPos).mockResolvedValue({ data: { id: 41, status: 'completed', detail: 'ok' } } as never);
    const onDone = vi.fn();
    renderWithProviders(<PosMirrorChoice ask={ask('office')} onDone={onDone} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Loyverse ya registró una recarga de $200.00 para Ana Inventada');
    await userEvent.click(screen.getByRole('button', { name: /Es esta misma: vincular/ }));
    await waitFor(() => expect(cafeteriaAdminApi.linkTopUpToPos).toHaveBeenCalledWith(41, 9));
    expect(onDone).toHaveBeenCalled();
    expect(cafeteriaAdminApi.applyOfficeTopUp).not.toHaveBeenCalled();
  });

  it('applies an office top-up on purpose with «Es otra recarga»', async () => {
    vi.mocked(cafeteriaAdminApi.applyOfficeTopUp).mockResolvedValue({ data: { detail: 'ok' } } as never);
    renderWithProviders(<PosMirrorChoice ask={ask('office')} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Es otra recarga: aplicar \$200.00/ }));
    await waitFor(() => expect(cafeteriaAdminApi.applyOfficeTopUp).toHaveBeenCalledWith(41, { confirm_pos_duplicate: true }));
  });

  it('a paid card top-up goes through the paid «Aplicar» with the confirmation', async () => {
    vi.mocked(cafeteriaAdminApi.applyPaidTopUp).mockResolvedValue({ data: { id: 41, status: 'completed', balance: '300', detail: 'ok' } } as never);
    renderWithProviders(<PosMirrorChoice ask={ask('paid')} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Es otra recarga/ }));
    await waitFor(() => expect(cafeteriaAdminApi.applyPaidTopUp).toHaveBeenCalledWith(41, { confirm_pos_duplicate: true }));
  });

  it('reads the ask from a 409 pos_already_mirrored answer only', () => {
    const err = { response: { status: 409, data: { code: 'pos_already_mirrored', detail: 'x', pos_transaction: 9, pos_date: 'd', pos_amount: '200.00' } } };
    expect(mirrorFromError(err)).toEqual({ pos_transaction: 9, pos_date: 'd', pos_amount: '200.00' });
    expect(mirrorFromError({ response: { data: { code: 'pos_not_loaded' } } })).toBeNull();
    expect(mirrorFromError(new Error('x'))).toBeNull();
  });
});
