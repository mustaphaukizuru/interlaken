import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';

vi.mock('@/services/api', () => ({
  cafeteriaApi: {
    getCards: vi.fn(),
    getLoyverseHistory: vi.fn().mockResolvedValue({ data: { linked: true, receipts: [] } }),
  },
}));
// JsBarcode measures its text on a canvas, which jsdom does not implement.
vi.mock('@/components/ui/Barcode', () => ({ Barcode: () => null }));

import CredencialPage from './CredencialPage';
import { cafeteriaApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import type { CafeteriaCard } from '@/types';

const getCards = vi.mocked(cafeteriaApi.getCards);

// The production case: 274 visits, purchases paid with points, and Loyverse's
// total_spent (cash/card only) at $0.00.
const CARD: CafeteriaCard = {
  student: { id: 10, name: 'Emma Quintana', grade: '4°', group: 'A', student_id: '09824' },
  code: 'ci09824',
  linked: true,
  balance: '120.00',
  is_low_balance: false,
  points: '120.00',
  consumption: { total: '907.00', since: '2024-09-03' },
  loyverse: {
    customer_code: 'ci09824', name: 'Quintana Emma-4PRI', email: '', phone_number: '',
    address_code: '4PRI', note: '', first_visit: '2024-08-26T14:00:00Z',
    last_visit: '2026-11-06T18:30:00Z', total_visits: 274, total_spent: '0.00',
    total_points: '120.00', loyverse_created_at: null, synced_at: '2026-11-07T12:00:00Z',
  },
};

/** The stat tile whose label is `label`. */
const tile = async (label: string) => (await screen.findByText(label)).parentElement as HTMLElement;

describe('CredencialPage activity: «Consumo registrado» (owner, 2026-11-08)', () => {
  const tz = process.env.TZ;

  beforeEach(() => {
    vi.clearAllMocks();
    // In Mexico City, '2024-09-03' read as UTC midnight is still 2 September.
    process.env.TZ = 'America/Mexico_City';
  });

  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it('shows the ledger consumption since the first purchase, not «Gasto histórico» or «Puntos»', async () => {
    getCards.mockResolvedValue({ data: [CARD] } as never);
    renderWithProviders(<CredencialPage />, { route: '/portal/credencial' });

    const consumo = await tile('Consumo registrado');
    expect(within(consumo).getByText('$907.00')).toBeInTheDocument();
    expect(within(consumo).getByText('desde 3 sep 2024')).toBeInTheDocument();
    expect(screen.queryByText('Gasto histórico')).toBeNull();
    expect(screen.queryByText('Puntos')).toBeNull();
    expect(within(await tile('Visitas')).getByText('274')).toBeInTheDocument();
  });

  it('says so when the student has no purchase yet', async () => {
    getCards.mockResolvedValue({ data: [{ ...CARD, consumption: { total: '0.00', since: null } }] } as never);
    renderWithProviders(<CredencialPage />, { route: '/portal/credencial' });

    const consumo = await tile('Consumo registrado');
    expect(within(consumo).getByText('$0.00')).toBeInTheDocument();
    expect(within(consumo).getByText('Sin compras registradas')).toBeInTheDocument();
  });
});
