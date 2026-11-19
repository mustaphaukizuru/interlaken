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

describe('CredencialPage: paid top-ups on their way (owner, 2026-11-19)', () => {
  beforeEach(() => vi.clearAllMocks());
  const face = () => screen.getByText('Código Loyverse').closest('.rounded-xl3') as HTMLElement;

  it('the card shows the real balance, the projection, and the line on white', async () => {
    getCards.mockResolvedValue({ data: [{
      ...CARD,
      pending_topups: [{ id: 3, amount: '200.00', paid_at: '2030-01-04T22:00:00Z', apply_due_at: '2030-01-07T13:30:00Z', folio: 3 }],
    }] } as never);
    renderWithProviders(<CredencialPage />, { route: '/portal/credencial' });
    expect(await screen.findByText('Saldo en caja')).toBeInTheDocument();
    expect(within(face()).getByText('$120.00')).toBeInTheDocument();
    expect(within(face()).getByText('$320.00')).toBeInTheDocument();
    expect(within(face()).getByText('Recarga de $200.00 pagada · disponible el lunes 7 de enero a las 7:30 a.m.')).toBeInTheDocument();
    expect(face().querySelector('.sr-only')).toHaveTextContent('Saldo actual $120.00. Con la recarga pagada de $200.00 será $320.00');
  });

  it('nothing pending: «Saldo» and the figure, as before', async () => {
    getCards.mockResolvedValue({ data: [{ ...CARD, pending_topups: [] }] } as never);
    renderWithProviders(<CredencialPage />, { route: '/portal/credencial' });
    expect(await screen.findByText('Saldo')).toBeInTheDocument();
    expect(within(face()).getByText('$120.00')).toBeInTheDocument();
    expect(screen.queryByText('Saldo en caja')).toBeNull();
    expect(within(face()).queryByText(/pagada/)).toBeNull();
  });
});

describe('CredencialPage: a staff member’s card never reads «Alumno» (2026-11-19)', () => {
  beforeEach(() => vi.clearAllMocks());
  const face = () => screen.getByText('Código Loyverse').closest('.rounded-xl3') as HTMLElement;
  const staff = (puesto: string, puesto_label: string) => ({
    ...CARD,
    student: { ...CARD.student, name: 'Caja Ejemplo', grade: '', group: '', tipo: 'personal' as const, puesto: puesto as never, puesto_label },
  });

  it('a pupil keeps grade and group', async () => {
    getCards.mockResolvedValue({ data: [{ ...CARD, student: { ...CARD.student, tipo: 'alumno' as const, puesto: '' as const, puesto_label: '' } }] } as never);
    renderWithProviders(<CredencialPage />, { route: '/portal/credencial' });
    await screen.findByText('Código Loyverse');
    expect(within(face()).getByText('4° · Grupo A')).toBeInTheDocument();
  });

  it('staff with a puesto: the puesto, no grade, no group', async () => {
    getCards.mockResolvedValue({ data: [staff('docente', 'Docente')] } as never);
    renderWithProviders(<CredencialPage />, { route: '/portal/mi-cafeteria/credencial' });
    await screen.findByText('Código Loyverse');
    expect(within(face()).getByText('Docente')).toBeInTheDocument();
    expect(within(face()).queryByText(/Alumno|Grupo/)).toBeNull();
  });

  it('staff without a puesto: «Personal del colegio», never «Sin asignar»', async () => {
    getCards.mockResolvedValue({ data: [staff('sin_asignar', 'Sin asignar')] } as never);
    renderWithProviders(<CredencialPage />, { route: '/portal/mi-cafeteria/credencial' });
    await screen.findByText('Código Loyverse');
    expect(within(face()).getByText('Personal del colegio')).toBeInTheDocument();
    expect(within(face()).queryByText(/Alumno|Sin asignar/)).toBeNull();
  });

  it('the full-screen scan view says the same', async () => {
    getCards.mockResolvedValue({ data: [staff('docente', 'Docente')] } as never);
    renderWithProviders(<CredencialPage />, { route: '/portal/mi-cafeteria/credencial' });
    (await screen.findByRole('button', { name: /Mostrar en pantalla completa/ })).click();
    const dialog = await screen.findByRole('dialog', { name: 'Código para escanear en caja' });
    expect(within(dialog).getByText('Docente')).toBeInTheDocument();
    expect(within(dialog).queryByText(/Alumno/)).toBeNull();
  });
});

describe('CredencialPage «Saldo bajo» follows the paid top-ups on their way', () => {
  beforeEach(() => vi.clearAllMocks());
  const low = { ...CARD, balance: '10.00', is_low_balance: true };

  it('hidden while a paid top-up covers the level (the server says so)', async () => {
    getCards.mockResolvedValue({ data: [{
      ...low, low_balance_alert: false,
      pending_topups: [{ id: 3, amount: '40.00', paid_at: '2030-01-04T22:00:00Z', apply_due_at: '2030-01-07T13:30:00Z', folio: 3 }],
    }] } as never);
    renderWithProviders(<CredencialPage />, { route: '/portal/credencial' });
    expect(await screen.findByText('$50.00')).toBeInTheDocument();
    expect(screen.queryByText('Saldo bajo')).toBeNull();
  });

  it('shown when the paid top-ups do not reach it', async () => {
    getCards.mockResolvedValue({ data: [{ ...low, low_balance_alert: true }] } as never);
    renderWithProviders(<CredencialPage />, { route: '/portal/credencial' });
    expect(await screen.findByText('Saldo bajo')).toBeInTheDocument();
  });

  it('an older API without the flag: the raw one', async () => {
    getCards.mockResolvedValue({ data: [low] } as never);
    renderWithProviders(<CredencialPage />, { route: '/portal/credencial' });
    expect(await screen.findByText('Saldo bajo')).toBeInTheDocument();
  });
});
