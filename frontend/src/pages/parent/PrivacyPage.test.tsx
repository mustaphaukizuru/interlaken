import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/api', () => ({
  legalApi: {
    getConsent: vi.fn(),
    recordConsent: vi.fn(),
    listArco: vi.fn(),
    createArco: vi.fn(),
    exportMyData: vi.fn(),
  },
}));

import toast from 'react-hot-toast';
import PrivacyPage from './PrivacyPage';
import { legalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const getConsent = vi.mocked(legalApi.getConsent);
const recordConsent = vi.mocked(legalApi.recordConsent);
const listArco = vi.mocked(legalApi.listArco);
const createArco = vi.mocked(legalApi.createArco);
const toastSuccess = vi.mocked(toast.success);

describe('PrivacyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConsent.mockResolvedValue({
      data: {
        state: {
          academic_processing: false,
          cafeteria: true,
          photos_media: false,
          communications_marketing: false,
          medical_data: false,
        },
        needs_acceptance: true,
        notice_version: '2026.1',
      },
    } as never);
    listArco.mockResolvedValue({ data: { results: [], count: 0 } } as never);
    recordConsent.mockResolvedValue({
      data: { state: { academic_processing: true }, needs_acceptance: false },
    } as never);
    createArco.mockResolvedValue({
      data: { id: 1, request_type: 'access', status: 'received' },
    } as never);
  });

  it('shows needs_acceptance banner and saves consent toggles', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PrivacyPage />, { route: '/portal/privacidad' });

    expect(await screen.findByText(/tratamiento académico del aviso vigente/i)).toBeInTheDocument();
    expect(screen.getByText(/v2026\.1/)).toBeInTheDocument();

    const academic = await screen.findByLabelText('Tratamiento académico');
    await user.click(academic);
    await user.click(screen.getByRole('button', { name: /Guardar consentimientos/i }));

    await waitFor(() => {
      expect(recordConsent).toHaveBeenCalledWith(
        expect.objectContaining({ academic_processing: true, cafeteria: true }),
      );
    });
    expect(toastSuccess).toHaveBeenCalledWith('Consentimientos actualizados.');
  });

  it('submits an ARCO request', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PrivacyPage />, { route: '/portal/privacidad' });

    await screen.findByText('Solicitud ARCO');
    await user.type(screen.getByLabelText('Detalle'), 'Quiero una copia de mis datos.');
    await user.click(screen.getByRole('button', { name: /Enviar solicitud/i }));

    await waitFor(() => {
      expect(createArco).toHaveBeenCalledWith('access', 'Quiero una copia de mis datos.');
    });
    expect(toastSuccess).toHaveBeenCalledWith('Solicitud ARCO enviada.');
  });
});
