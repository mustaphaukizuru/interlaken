import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
  },
  admissionsAdminApi: {
    invitePreRegistration: vi.fn(),
    listRegistrations: vi.fn(),
  },
}));

vi.mock('@/components/admin/RegistrationReviewModal', () => ({
  RegistrationReviewModal: ({ open, id }: { open: boolean; id: number | null }) =>
    open ? <div role="dialog" aria-label="Revisión">{`Expediente #${id}`}</div> : null,
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import toast from 'react-hot-toast';
import AdminAdmissions from './AdminAdmissions';
import { api, admissionsAdminApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const mockedGet = vi.mocked(api.get);
const mockedPatch = vi.mocked(api.patch);
const mockedInvite = vi.mocked(admissionsAdminApi.invitePreRegistration);
const mockedListRegs = vi.mocked(admissionsAdminApi.listRegistrations);
const toastSuccess = vi.mocked(toast.success);

const SAMPLE = {
  id: 7,
  child_name: 'Ana Pérez',
  level: 'primaria',
  grade_applying: 'Primaria 1°',
  parent_name: 'Roberto Pérez',
  parent_email: 'roberto@test.mx',
  parent_phone: '5551234567',
  status: 'pending',
  created_at: '2026-08-01T12:00:00Z',
};

function mockLists(preRegs = [SAMPLE]) {
  mockedGet.mockImplementation(async (url: string) => {
    if (String(url).includes('/admissions/pre-register/')) {
      return { data: { results: preRegs, count: preRegs.length } } as never;
    }
    throw new Error(`unexpected GET ${url}`);
  });
  mockedListRegs.mockResolvedValue({ data: { results: [], count: 0 } } as never);
}

describe('AdminAdmissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    mockLists();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders pre-registration rows and empty inscripciones section', async () => {
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones' });

    expect((await screen.findAllByText('Ana Pérez')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Roberto Pérez').length).toBeGreaterThan(0);
    expect(screen.getByText('Sin inscripciones')).toBeInTheDocument();
  });

  it('shows error state and recovers on retry', async () => {
    mockedGet
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: { results: [], count: 0 } } as never);
    mockedListRegs.mockResolvedValue({ data: { results: [], count: 0 } } as never);

    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones' });

    expect(await screen.findByText('No se pudo cargar la información')).toBeInTheDocument();
    expect(screen.queryByText('Sin pre-registros')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('Sin pre-registros')).toBeInTheDocument();
  });

  it('patches status from the status select', async () => {
    const user = userEvent.setup();
    mockedPatch.mockResolvedValue({ data: { ...SAMPLE, status: 'contacted' } } as never);

    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones' });
    await screen.findAllByText('Ana Pérez');

    const selects = screen.getAllByLabelText('Cambiar estado del pre-registro');
    await user.selectOptions(selects[0], 'contacted');

    await waitFor(() => {
      expect(mockedPatch).toHaveBeenCalledWith('/admissions/pre-register/7/', { status: 'contacted' });
    });
    expect(toastSuccess).toHaveBeenCalledWith('Estado actualizado.');
  });

  it('invites to enrollment and shows the invite URL banner', async () => {
    const user = userEvent.setup();
    mockedInvite.mockResolvedValue({
      data: { invite_url: 'https://interlaken.edu.mx/inscripcion?token=abc' },
    } as never);

    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones' });
    await screen.findAllByText('Ana Pérez');

    const inviteBtns = screen.getAllByRole('button', { name: /invitar/i });
    await user.click(inviteBtns[0]);

    await waitFor(() => {
      expect(mockedInvite).toHaveBeenCalledWith(7);
    });
    expect(await screen.findByText(/Invitación generada para Ana Pérez/i)).toBeInTheDocument();
    expect(screen.getByText('https://interlaken.edu.mx/inscripcion?token=abc')).toBeInTheDocument();
  });

  it('sends debounced search to the pre-register list API', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones' });
    await screen.findAllByText('Ana Pérez');

    mockedGet.mockClear();
    mockLists([SAMPLE]);

    await user.type(screen.getByLabelText('Buscar pre-registros'), 'roberto@');

    await waitFor(
      () => {
        expect(mockedGet).toHaveBeenCalledWith(
          '/admissions/pre-register/',
          expect.objectContaining({
            params: expect.objectContaining({ search: 'roberto@', page: 1 }),
          }),
        );
      },
      { timeout: 2000 },
    );
  });

  it('opens registration review dialog from inscripciones', async () => {
    const user = userEvent.setup();
    mockedListRegs.mockResolvedValue({
      data: {
        results: [{
          id: 3,
          child_name: 'Luis Ruiz',
          grade_applying: 'Primaria 2°',
          cycle: '2026-2027',
          parent1_name: 'María Ruiz',
          parent1_email: 'maria@test.mx',
          parent1_phone: '5559999999',
          status: 'submitted',
          submitted_at: '2026-08-02T10:00:00Z',
          created_at: '2026-08-01T10:00:00Z',
          doc_count: 2,
          doc_verified: 1,
        }],
        count: 1,
      },
    } as never);

    renderWithProviders(<AdminAdmissions />, { route: '/admin/admisiones' });
    expect((await screen.findAllByText('Luis Ruiz')).length).toBeGreaterThan(0);

    const reviewBtns = screen.getAllByRole('button', { name: /revisar/i });
    await user.click(reviewBtns[0]);

    expect(await screen.findByRole('dialog', { name: /revisión/i })).toHaveTextContent('Expediente #3');
  });
});
