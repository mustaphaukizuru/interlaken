import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({ api: { post: vi.fn() } }));

import { ImportStaffModal, type StaffImportReport, type StaffRow } from './ImportStaffModal';
import { api } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

/** «Importar personal desde Loyverse» (A3 + A5). Invented names and codes. */
const row = (over: Partial<StaffRow>): StaffRow => ({
  loyverse_id: 'u-1', loyverse_name: 'ZP-Rosa Lince Vela', name: 'Rosa Lince Vela', code: 'rlince',
  email: 'rlince@interlaken.com.mx', balance: '50.00', total_visits: 4, last_visit: '2026-11-10T15:00:00Z',
  pending_receipts: 2, flags: [], action: 'crear', note: '', existing: null, ...over,
});
const review: StaffImportReport = {
  total_customers: 5, staff_customers: 3, commit: false,
  counts: { crear: 1, vincular_cuenta: 0, vincular: 0, al_dia: 0, convertir: 1, conflicto: 1, omitir: 0 },
  rows: [
    row({}),
    row({ loyverse_id: 'u-2', name: 'Tomás Vela Ruiz', loyverse_name: 'ZP-Tomás Vela Ruiz', code: 'tvvela',
      email: 'tvela@interlaken.com.mx', action: 'convertir', flags: ['codigo_distinto'],
      note: 'Registrado como alumno (3° Secundaria).',
      existing: { id: 41, name: 'Tomás Vela Ruiz', student_id: 'TVVELA', tipo: 'alumno', grade: '3° Secundaria', role: 'student' } }),
    row({ loyverse_id: 'u-3', name: 'Nora Sur Paz', code: 'nspaz', email: 'nspaz@interlaken.com.mx', action: 'conflicto',
      total_visits: 0, flags: ['sin_actividad'], note: 'Ya está vinculado a otra tarjeta de Loyverse; no se cambia.' }),
  ],
  created: 0, attached: 0, linked: 0, converted: 0, balance_seeded: '0.00', recovered_receipts: 0, errors: [],
};
const post = vi.mocked(api.post);

describe('ImportStaffModal', () => {
  beforeEach(() => post.mockReset());

  it('reviews first, converts only what is ticked, then reports the recovered purchases', async () => {
    post.mockResolvedValueOnce({ data: review } as never).mockResolvedValueOnce({ data: {
      ...review, commit: true, created: 1, converted: 1, balance_seeded: '50.00', recovered_receipts: 2,
    } } as never);
    const onImported = vi.fn();
    renderWithProviders(<ImportStaffModal open onClose={() => {}} onImported={onImported} />);

    expect(await screen.findByText('Rosa Lince Vela')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/accounts/admin/import-staff-loyverse/', { commit: '0' });
    expect(screen.getByText('Código distinto al correo')).toBeInTheDocument();
    expect(screen.getAllByText('Sin actividad').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 compra(s) por recuperar').length).toBeGreaterThan(0);

    // Without ticking: only the new one would be written.
    expect(screen.getByRole('button', { name: /Importar 1/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Convertir a Personal' }));
    await userEvent.click(screen.getByRole('button', { name: /Importar 2/ }));

    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/accounts/admin/import-staff-loyverse/', { commit: '1', convert: [41] }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('1 creado(s), 1 convertido(s) a Personal');
    expect(within(status).getByText(/2 compra\(s\) anteriores ahora aparecen en su historial/)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalled();
  });

  it('filters the review by what will happen', async () => {
    post.mockResolvedValueOnce({ data: review } as never);
    renderWithProviders(<ImportStaffModal open onClose={() => {}} />);
    await screen.findByText('Rosa Lince Vela');
    await userEvent.click(screen.getByRole('button', { name: /Conflicto \(1\)/ }));
    expect(screen.queryByText('Rosa Lince Vela')).toBeNull();
    expect(screen.getByText('Nora Sur Paz')).toBeInTheDocument();
  });

  it('says when Loyverse cannot be reached', async () => {
    post.mockRejectedValueOnce({ response: { status: 502, data: { detail: 'No se pudo conectar con Loyverse: x' } } });
    renderWithProviders(<ImportStaffModal open onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar con Loyverse');
  });
});
