import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', async () => ({
  ...(await vi.importActual<typeof import('@/services/dataOps')>('@/services/dataOps')),
  downloadBlob: vi.fn(),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  admissionsAdminApi: {},
}));
vi.mock('@/components/admin/RegistrationReviewModal', () => ({ RegistrationReviewModal: () => null }));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 't'), dismiss: vi.fn() },
}));

import AdminAdmissions from './AdminAdmissions';
import { api, downloadBlob } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';

const get = vi.mocked(api.get);
const blob = new Blob(['x']);
const REG = {
  id: 3, child_name: 'Luis Ruiz', level: 'primaria', grade_applying: '2° Primaria', cycle: '2026-2027',
  parent1_name: 'María Ruiz', parent1_email: 'maria@test.mx', parent1_phone: '5559999999',
  status: 'submitted', submitted_at: '2026-08-02T10:00:00Z', created_at: '2026-08-01T10:00:00Z',
  doc_count: 2, doc_verified: 1,
};

describe('AdminAdmissions · fichas (Fase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubViewport(1280);
    get.mockImplementation(async (url: string) => {
      if (url === '/admissions/register/') return { data: { count: 1, next: null, previous: null, results: [REG] } } as never;
      return { data: blob, headers: {} } as never;
    });
  });

  it('each inscripción row offers its ficha in Excel and PDF', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones?vista=inscripciones' });
    await screen.findByText('Luis Ruiz');
    await user.click(screen.getByRole('button', { name: 'Descargar la ficha de inscripción de Luis Ruiz' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ficha de Luis Ruiz en Excel' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/admissions/register/3/ficha/export/', {
      params: { fmt: 'xlsx' }, responseType: 'blob',
    }));
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'Ficha_de_inscripcion_3.xlsx');
  });

  it('the Exportar menu carries «Concentrado de fichas» with the list filters and the blank form', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones?vista=inscripciones&estado=submitted' });
    await screen.findByText('Luis Ruiz');
    await user.click(screen.getByRole('button', { name: /^Exportar$/ }));
    const menu = screen.getByRole('menu', { name: 'Formatos de exportación' });
    expect(within(menu).getByRole('menuitem', { name: /Ficha en blanco \(PDF\)/ })).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: /Concentrado de fichas/ }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/admissions/register/fichas/concentrado/', {
      params: { status: 'submitted', fmt: 'xlsx', ids: undefined, q: undefined, level: undefined, cycle: undefined,
        documents_pending: undefined, from: undefined, to: undefined, ordering: undefined },
      responseType: 'blob',
    }));
  });

  it('the bulk bar downloads the selected fichas as a ZIP', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones?vista=inscripciones' });
    await screen.findByText('Luis Ruiz');
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar inscripción de Luis Ruiz' }));
    const bar = screen.getByRole('region', { name: 'Acciones en lote' });
    await user.click(within(bar).getByRole('button', { name: /Fichas \(ZIP\)/ }));
    await user.click(screen.getByRole('menuitem', { name: /PDF/ }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/admissions/register/fichas/export/', {
      params: { ids: '3', fmt: 'pdf' }, responseType: 'blob',
    }));
  });
});
