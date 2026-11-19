import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

/**
 * «Mi cafetería» (2026-11-18): a console user's own staff wallet. Every call
 * carries `mine`, so the API answers with that account only. Invented names.
 */
vi.mock('@/services/api', () => ({
  downloadBlob: vi.fn(),
  cafeteriaApi: {
    getMyBalance: vi.fn(),
    getTransactions: vi.fn().mockResolvedValue({ data: { results: [], count: 0 } }),
    exportMyTransactions: vi.fn(),
    requestTopUp: vi.fn(),
    getSpendingCategories: vi.fn().mockResolvedValue({ data: { days: 30, total: 0, categories: [] } }),
    getCards: vi.fn().mockResolvedValue({ data: [] }),
    getLoyverseHistory: vi.fn(),
    statementPdf: vi.fn(),
    updateLowBalanceThreshold: vi.fn(),
    updateSpendLimits: vi.fn(),
  },
  paymentsApi: {
    getAvailability: vi.fn().mockResolvedValue({ data: { online: true } }),
    getBillingProfile: vi.fn().mockResolvedValue({ data: { data: {}, states: [] } }),
  },
}));
vi.mock('@/lib/banorteCheckout', () => ({ openBanorteLightbox: vi.fn(), closeBanorteLightbox: vi.fn() }));

import MyCafeteriaPage from './MyCafeteriaPage';
import { cafeteriaApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const ownWallet = {
  id: 1, balance: '20500.00', low_balance_threshold: '20.00', last_synced: '2026-11-18T13:00:00Z',
  is_low_balance: false,
  student: {
    id: 77, student_id: '541999', grade: '', group: '', loyverse_id: 'u-caja', tipo: 'personal',
    puesto: 'direccion', puesto_label: 'Dirección', is_active: true,
    user: { id: 3, full_name: 'Caja Central', first_name: 'Caja', last_name: 'Central', email: 'caja@x.mx' },
  },
};

describe('MyCafeteriaPage', () => {
  beforeEach(() => {
    vi.mocked(cafeteriaApi.getMyBalance).mockReset().mockResolvedValue({ data: [ownWallet] } as never);
  });

  it('asks for the caller’s own account and titles the page «Mi cafetería»', async () => {
    renderWithProviders(<MyCafeteriaPage />, { route: '/portal/mi-cafeteria' });
    expect(await screen.findByRole('heading', { name: 'Mi cafetería' })).toBeInTheDocument();
    expect(cafeteriaApi.getMyBalance).toHaveBeenCalledWith(true);
    // A staff wallet shows the puesto, never «Grupo».
    expect(await screen.findByText('Dirección')).toBeInTheDocument();
    expect(screen.queryByText(/Grupo/)).toBeNull();
    await waitFor(() => expect(cafeteriaApi.getTransactions).toHaveBeenCalledWith(expect.objectContaining({ mine: 1 })));
    expect(cafeteriaApi.getSpendingCategories).toHaveBeenCalledWith(30, undefined, true);
    expect(screen.getByRole('link', { name: 'Mi credencial' })).toHaveAttribute('href', '/portal/mi-cafeteria/credencial');
  });

  it('a paid top-up on the own wallet shows where the balance is heading', async () => {
    vi.mocked(cafeteriaApi.getMyBalance).mockResolvedValue({ data: [{
      ...ownWallet,
      pending_topups: [{ id: 5, amount: '120.00', paid_at: '2030-01-04T22:00:00Z', apply_due_at: '2030-01-07T13:30:00Z', folio: 5 }],
    }] } as never);
    renderWithProviders(<MyCafeteriaPage />, { route: '/portal/mi-cafeteria' });
    await waitFor(() => expect(document.getElementById('saldos-cafeteria')).not.toBeNull());
    const saldos = within(document.getElementById('saldos-cafeteria') as HTMLElement);
    expect(await saldos.findByText('$20,620.00')).toBeInTheDocument();
    expect(saldos.getByText('$20,500.00')).toBeInTheDocument();
    expect(saldos.getByText('Saldo en caja')).toBeInTheDocument();
    expect(saldos.getByText('Recarga de $120.00 pagada · disponible el lunes 7 de enero a las 7:30 a.m.')).toBeInTheDocument();
    expect(cafeteriaApi.getMyBalance).toHaveBeenCalledWith(true);
  });

  it('shows the own credential with the same scope', async () => {
    renderWithProviders(<MyCafeteriaPage view="credencial" />, { route: '/portal/mi-cafeteria/credencial' });
    expect(await screen.findByRole('heading', { name: 'Mi credencial de cafetería' })).toBeInTheDocument();
    expect(cafeteriaApi.getCards).toHaveBeenCalledWith(true);
  });
});
