import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  portalApi: {
    adminListAnnouncements: vi.fn(),
    adminCreateAnnouncement: vi.fn(),
    adminUpdateAnnouncement: vi.fn(),
    adminDeleteAnnouncement: vi.fn(),
    adminEmergencyBroadcast: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import toast from 'react-hot-toast';
import AdminAnnouncements from './AdminAnnouncements';
import { portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const list = vi.mocked(portalApi.adminListAnnouncements);
const create = vi.mocked(portalApi.adminCreateAnnouncement);
const broadcast = vi.mocked(portalApi.adminEmergencyBroadcast);
const toastSuccess = vi.mocked(toast.success);
const toastError = vi.mocked(toast.error);

const SAMPLE = {
  id: 4,
  title: 'Junta de padres',
  body: 'Reunión el viernes a las 8:00.',
  audience: 'parents',
  is_active: false,
  created_at: '2026-08-01T12:00:00Z',
  created_by_name: 'Admin',
  read_count: 3,
};

describe('AdminAnnouncements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({ data: { results: [SAMPLE] } } as never);
    create.mockResolvedValue({ data: {} } as never);
    broadcast.mockResolvedValue({
      data: { notified: 12, dispatched: 4, whatsapp_sent: 0 },
    } as never);
  });

  it('renders list title, audience, read count, and inactive badge', async () => {
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });

    expect(await screen.findByText('Junta de padres')).toBeInTheDocument();
    expect(screen.getByText('Padres')).toBeInTheDocument();
    expect(screen.getByText(/3 leídos/i)).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
  });

  it('disables publish until title/body exist, then creates the comunicado', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    await screen.findByText('Junta de padres');

    await user.click(screen.getByRole('button', { name: /Nuevo comunicado/i }));
    const dialog = await screen.findByRole('dialog');
    const publish = within(dialog).getByRole('button', { name: /^Publicar$/i });
    expect(publish).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/^Título$/i), {
      target: { value: 'Suspensión' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Mensaje$/i), {
      target: { value: 'No hay clases mañana.' },
    });
    expect(publish).toBeEnabled();

    await user.click(publish);
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        title: 'Suspensión',
        body: 'No hay clases mañana.',
        audience: 'all',
        is_active: true,
      });
    });
    expect(toastSuccess).toHaveBeenCalledWith('Comunicado publicado.');
  });

  it('requires confirmation before sending an urgent broadcast', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    await screen.findByText('Junta de padres');

    await user.click(screen.getByRole('button', { name: /Aviso urgente/i }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: /Enviar aviso urgente/i });
    expect(send).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/^Título$/i), {
      target: { value: '  Contingencia  ' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Mensaje$/i), {
      target: { value: '  Quedan suspendidas las clases.  ' },
    });
    expect(send).toBeDisabled();

    await user.click(
      within(dialog).getByLabelText(/Confirmo que este aviso es urgente/i),
    );
    expect(send).toBeEnabled();

    await user.click(send);
    await waitFor(() => {
      expect(broadcast).toHaveBeenCalledWith({
        title: 'Contingencia',
        message: 'Quedan suspendidas las clases.',
        audience: 'parents',
        whatsapp: false,
      });
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'Aviso urgente enviado: 12 notificados, 4 por correo/push.',
    );
  });

  it('surfaces backend error text from emergency broadcast', async () => {
    const user = userEvent.setup();
    broadcast.mockRejectedValueOnce({
      response: { data: { error: 'WhatsApp no configurado.' } },
    });
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    await screen.findByText('Junta de padres');

    await user.click(screen.getByRole('button', { name: /Aviso urgente/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Título$/i), {
      target: { value: 'Alerta' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Mensaje$/i), {
      target: { value: 'Detalle' },
    });
    await user.click(
      within(dialog).getByLabelText(/Confirmo que este aviso es urgente/i),
    );
    await user.click(within(dialog).getByRole('button', { name: /Enviar aviso urgente/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('WhatsApp no configurado.');
    });
  });
});
