import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/caja', () => ({
  cajaApi: { lookup: vi.fn(), today: vi.fn(), create: vi.fn(), void: vi.fn(), verify: vi.fn(), get: vi.fn() },
  corteApi: { get: vi.fn(), people: vi.fn(), close: vi.fn(), reopen: vi.fn() },
  newIdempotencyKey: () => 'key-1',
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AdminCaja from './AdminCaja';
import { cajaApi, corteApi } from '@/services/caja';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useAuthStore } from '@/store/authStore';

const api = vi.mocked(cajaApi);
const ANA = {
  id: 7, name: 'Ana Prueba', tipo: 'alumno' as const, grade: '3° Primaria', group: 'A', puesto_label: '',
  student_id: '09999', code: 'ci09999', photo: '', balance: '100.00', linked: true,
};
const topup = (over: Record<string, unknown> = {}) => ({
  id: 11, folio: 'R-000011', student: { id: 7, name: 'Ana Prueba', grade: '3° Primaria', group: 'A', tipo: 'alumno' },
  amount: '200.00', desk_method: 'cash', desk_method_label: 'Efectivo', reference: '', note: '',
  received_by: 'Caja Prueba', created_at: '2026-11-27T14:00:00Z', status: 'completed', state: 'pushed',
  push_note: '', balance: '300.00', voided_at: null, voided_by: '', void_reason: '',
  needs_verification: false, verified_at: null, ...over,
});

async function scanAna() {
  const user = userEvent.setup();
  renderWithProviders(<AdminCaja />, { route: '/admin/caja' });
  const field = screen.getByLabelText('Credencial o matrícula');
  expect(field).toHaveFocus(); // a USB scanner types straight into it
  await user.type(field, 'ci09999{Enter}');
  await screen.findByText('Ana Prueba');
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 3, email: 'caja@x.mx', role: 'staff', staff_areas: ['caja'] } as never });
  api.today.mockResolvedValue({ data: { results: [] } } as never);
  api.lookup.mockResolvedValue({ data: { results: [ANA] } } as never);
});

describe('AdminCaja', () => {
  it('scans, confirms the child and records cash: Loyverse first, then the outcome', async () => {
    api.create.mockResolvedValue({ data: { topup: topup(), outcome: { state: 'pushed', reason: '', balance: '300.00' }, created: true } } as never);
    const user = await scanAna();
    expect(api.lookup).toHaveBeenCalledWith('ci09999');
    expect(screen.getByText(/Saldo actual:/)).toHaveTextContent('$100.00');
    await user.click(screen.getByRole('button', { name: '$200.00' }));
    await user.click(screen.getByRole('button', { name: 'Registrar recarga de $200.00' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      student: 7, amount: '200', desk_method: 'cash', idempotency_key: 'key-1', confirm_duplicate: false,
    })));
    expect(await screen.findByText(/Cargada en Loyverse: Ana Prueba ya puede gastar \$200.00/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Imprimir recibo/ })).toHaveAttribute('href', '/admin/caja/recibo/11');
  });

  it('card needs the terminal authorisation and the maximum is $1,000', async () => {
    const user = await scanAna();
    await user.type(screen.getByLabelText('Monto de la recarga'), '1200');
    expect(screen.getByRole('alert')).toHaveTextContent('El máximo es $1,000.00 por recarga.');
    await user.clear(screen.getByLabelText('Monto de la recarga'));
    await user.type(screen.getByLabelText('Monto de la recarga'), '150');
    await user.click(screen.getByLabelText('Tarjeta en recepción'));
    const submit = screen.getByRole('button', { name: 'Registrar recarga de $150.00' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Número de autorización de la terminal'), '123456');
    expect(submit).toBeEnabled();
  });

  it('asks before recording the same amount twice', async () => {
    api.create
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 409, data: { code: 'possible_duplicate', detail: 'Hace unos minutos se registró una recarga igual para Ana Prueba (folio R-000010). ¿Es otra recarga?' } } })
      .mockResolvedValueOnce({ data: { topup: topup(), outcome: { state: 'pushed', reason: '', balance: '500.00' }, created: true } } as never);
    const user = await scanAna();
    await user.click(screen.getByRole('button', { name: '$200.00' }));
    await user.click(screen.getByRole('button', { name: 'Registrar recarga de $200.00' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Es otra recarga?' });
    expect(dialog).toHaveTextContent('R-000010');
    await user.click(within(dialog).getByRole('button', { name: 'Sí, registrar otra' }));
    await waitFor(() => expect(api.create).toHaveBeenLastCalledWith(expect.objectContaining({ confirm_duplicate: true })));
  });

  it('a top-up Loyverse could not take yet says so and never says «cargada»', async () => {
    api.create.mockResolvedValue({ data: { topup: topup({ state: 'waiting', status: 'pending' }), outcome: { state: 'waiting', reason: 'busy', balance: '100.00' }, created: true } } as never);
    const user = await scanAna();
    await user.click(screen.getByRole('button', { name: '$100.00' }));
    await user.click(screen.getByRole('button', { name: 'Registrar recarga de $100.00' }));
    expect(await screen.findByText(/Pendiente de cargar en Loyverse/)).toBeInTheDocument();
    expect(screen.queryByText(/ya puede gastar/)).toBeNull();
  });

  it('voids with a required reason, and offers «Verificar» on card/link rows', async () => {
    api.today.mockResolvedValue({ data: { results: [
      topup(), topup({ id: 12, folio: 'R-000012', desk_method: 'link', desk_method_label: 'Liga de pago', reference: 'LIGA-1', needs_verification: true }),
    ] } } as never);
    api.void.mockResolvedValue({ data: { result: { state: 'voided', balance: '100.00' }, topup: topup({ state: 'voided' }) } } as never);
    const user = userEvent.setup();
    renderWithProviders(<AdminCaja />, { route: '/admin/caja' });
    const list = await screen.findByRole('list', { name: 'Recargas de hoy' });
    expect(within(list).getByRole('button', { name: 'Verificar en MultiCobros la recarga R-000012' })).toBeInTheDocument();
    expect(screen.getByText(/Efectivo \$200.00 · Tarjeta \$0.00 · Liga de pago \$200.00/)).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Anular la recarga R-000011' }));
    const dialog = await screen.findByRole('dialog', { name: 'Anular recarga' });
    const confirm = within(dialog).getByRole('button', { name: 'Anular recarga' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Motivo (obligatorio)'), 'Monto equivocado');
    await user.click(confirm);
    await waitFor(() => expect(api.void).toHaveBeenCalledWith(11, 'Monto equivocado'));
  });

  it('an unlinked account cannot be recharged', async () => {
    api.lookup.mockResolvedValue({ data: { results: [{ ...ANA, linked: false }] } } as never);
    await scanAna();
    expect(screen.getByRole('alert')).toHaveTextContent('aún no está vinculada a Loyverse');
    expect(screen.getByRole('button', { name: 'Registrar recarga' })).toBeDisabled();
  });
});

describe('AdminCaja: corte de caja tab (Part 2)', () => {
  it('opens the corte from its tab and keeps it in the address', async () => {
    vi.mocked(corteApi.get).mockResolvedValue({ data: {
      day: '2026-11-27', user: { id: 3, name: 'Caja Prueba' }, expected: { cash: '0.00', card: '0.00', link: '0.00' },
      expected_total: '0.00', count: 0, pending_load: { count: 0, amount: '0.00' }, topups: [], voids: [],
      duplicates: [], close: null, is_today: true,
    } } as never);
    const user = userEvent.setup();
    renderWithProviders(<AdminCaja />, { route: '/admin/caja' });
    await user.click(screen.getByRole('tab', { name: 'Corte de caja' }));
    expect(await screen.findByText(/No hay recargas registradas ese día/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Credencial o matrícula')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Corte de caja' })).toHaveAttribute('aria-selected', 'true');
  });
});
