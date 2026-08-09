import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  contentApi: {
    adminGetSettings: vi.fn(),
    adminUpdateSettings: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import toast from 'react-hot-toast';
import AdminSettings from './AdminSettings';
import { contentApi } from '@/services/api';

const mockedGet = vi.mocked(contentApi.adminGetSettings);
const mockedPatch = vi.mocked(contentApi.adminUpdateSettings);
const toastError = vi.mocked(toast.error);

const SAMPLE = {
  phone_display: '(55) 5379-1188',
  phone_e164: '+525553791188',
  whatsapp_number: '5215553791188',
  contact_email: 'colegio@interlaken.edu.mx',
  address: 'Av. de los Reyes 67, Tlalnepantla',
  maps_url: 'https://maps.app.goo.gl/example',
  office_hours: 'Lunes–Viernes 8:00–16:00 hrs',
  facebook_url: 'https://www.facebook.com/colegiointerlaken',
  instagram_url: '',
  youtube_url: '',
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AdminSettings />
    </QueryClientProvider>,
  );
}

describe('AdminSettings (CMS preview + density)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form fields and a live public chrome preview', async () => {
    mockedGet.mockResolvedValueOnce({ data: SAMPLE } as never);
    renderPage();

    // Wait until the query hydrates form state (input mounts empty first).
    await waitFor(() => {
      expect(screen.getByLabelText('WhatsApp')).toHaveValue(SAMPLE.whatsapp_number);
    });
    expect(screen.getByText('Vista previa del sitio')).toBeInTheDocument();
    expect(screen.getByText('Barra superior')).toBeInTheDocument();
    expect(screen.getByText('Pie de contacto')).toBeInTheDocument();
    expect(screen.getByLabelText('Vista previa del botón de WhatsApp')).toBeInTheDocument();
    // Preview mirrors contact values (may appear in form + preview).
    expect(screen.getAllByText(SAMPLE.phone_display).length).toBeGreaterThanOrEqual(1);
  });

  it('hides WhatsApp float preview when number is cleared', async () => {
    mockedGet.mockResolvedValueOnce({ data: SAMPLE } as never);
    renderPage();

    const wa = await screen.findByLabelText('WhatsApp');
    await waitFor(() => expect(wa).toHaveValue(SAMPLE.whatsapp_number));
    await userEvent.clear(wa);
    await waitFor(() => {
      expect(screen.queryByLabelText('Vista previa del botón de WhatsApp')).toBeNull();
    });
    expect(
      screen.getByText(/Sin número de WhatsApp/i),
    ).toBeInTheDocument();
  });

  it('saves settings via the API', async () => {
    mockedGet.mockResolvedValueOnce({ data: SAMPLE } as never);
    mockedPatch.mockResolvedValueOnce({ data: SAMPLE } as never);
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('WhatsApp')).toHaveValue(SAMPLE.whatsapp_number);
    });
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(mockedPatch).toHaveBeenCalledTimes(1));
    expect(mockedPatch.mock.calls[0][0]).toMatchObject({
      whatsapp_number: SAMPLE.whatsapp_number,
      phone_display: SAMPLE.phone_display,
    });
  });

  it('surfaces DRF field errors under the matching inputs', async () => {
    mockedGet.mockResolvedValueOnce({ data: SAMPLE } as never);
    mockedPatch.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          contact_email: ['Introduzca una dirección de correo electrónico válida.'],
          maps_url: ['Introduzca una URL válida.'],
        },
      },
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('WhatsApp')).toHaveValue(SAMPLE.whatsapp_number);
    });
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));

    expect(
      await screen.findByText('Introduzca una dirección de correo electrónico válida.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Introduzca una URL válida.')).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith('Revise los campos marcados e intente de nuevo.');
    expect(mockedPatch).toHaveBeenCalledTimes(1);
  });

  it('clears a field error when the admin edits that input', async () => {
    mockedGet.mockResolvedValueOnce({ data: SAMPLE } as never);
    mockedPatch.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          contact_email: ['Introduzca una dirección de correo electrónico válida.'],
        },
      },
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('Correo de contacto')).toHaveValue(SAMPLE.contact_email);
    });
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    expect(
      await screen.findByText('Introduzca una dirección de correo electrónico válida.'),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Correo de contacto'), 'x');
    await waitFor(() => {
      expect(
        screen.queryByText('Introduzca una dirección de correo electrónico válida.'),
      ).not.toBeInTheDocument();
    });
  });
});
