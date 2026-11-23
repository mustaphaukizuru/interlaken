import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/AdminContentApi', () => ({
  announcementsAdminApi: { list: vi.fn(), export: vi.fn(), bulk: vi.fn(), deliveryExport: vi.fn() },
}));

vi.mock('@/services/api', () => ({
  portalApi: {
    adminCreateAnnouncement: vi.fn(),
    adminUpdateAnnouncement: vi.fn(),
    adminDeleteAnnouncement: vi.fn(),
    adminEmergencyBroadcast: vi.fn(),
    getAnnouncementRecipientCount: vi.fn(),
    getAnnouncementDelivery: vi.fn(),
    resendAnnouncementFailed: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 't1'), dismiss: vi.fn() },
}));

import toast from 'react-hot-toast';
import AdminAnnouncements from './AdminAnnouncements';
import { portalApi } from '@/services/api';
import { announcementsAdminApi } from '@/services/AdminContentApi';
import { stubViewport } from '@/test/viewport';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useAuthStore } from '@/store/authStore';

const ADMIN = { id: 1, email: 'a@x.mx', first_name: 'A', last_name: 'B', full_name: 'A B', role: 'admin' as const, avatar: '', whatsapp: '' };

const list = vi.mocked(announcementsAdminApi.list);
const bulk = vi.mocked(announcementsAdminApi.bulk);
const exportList = vi.mocked(announcementsAdminApi.export);
const create = vi.mocked(portalApi.adminCreateAnnouncement);
const broadcast = vi.mocked(portalApi.adminEmergencyBroadcast);
const recipientCount = vi.mocked(portalApi.getAnnouncementRecipientCount);
const delivery = vi.mocked(portalApi.getAnnouncementDelivery);
const toastSuccess = vi.mocked(toast.success);
const toastError = vi.mocked(toast.error);

const SAMPLE = {
  id: 4,
  title: 'Junta de padres',
  body: 'Reunión el viernes a las 8:00.',
  audience: 'parents',
  is_active: false,
  push_enabled: true,
  created_at: '2026-08-01T12:00:00Z',
  created_by_name: 'Admin',
  read_count: 3,
};

describe('AdminAnnouncements', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: ADMIN, accessToken: 't', isAuthenticated: true });
    vi.clearAllMocks();
    stubViewport(1280);
    list.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [SAMPLE] } } as never);
    create.mockResolvedValue({ data: {} } as never);
    broadcast.mockResolvedValue({
      data: { announcement_id: 9, notified: 12, dispatched: 4, whatsapp_queued: 0, whatsapp_configured: true },
    } as never);
  });

  it('renders list title, audience, read count, and inactive badge', async () => {
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });

    expect(await screen.findByText('Junta de padres')).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Junta de padres/ });
    expect(within(row).getByText('Padres')).toBeInTheDocument();
    expect(within(row).getByText(/3 leídos/i)).toBeInTheDocument();
    expect(within(row).getByText('Inactivo')).toBeInTheDocument();
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

    // Sending now asks once more, naming the audience; nothing is sent yet.
    await user.click(publish);
    const confirm = within(dialog).getByRole('alertdialog', { name: /¿Enviar ahora\?/i });
    expect(confirm).toHaveTextContent(/«Suspensión» se enviará ahora a: todos, por notificación en el portal, correo y push/);
    expect(within(confirm).getByRole('button', { name: /^Volver$/i })).toHaveFocus();
    expect(create).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: /^Enviar ahora$/i }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Suspensión',
        body: 'No hay clases mañana.',
        audience: 'all',
        is_active: true,
        push_enabled: true,
        show_on_site: false,
      }));
    });
    expect(toastSuccess).toHaveBeenCalledWith('Comunicado publicado y enviado.');
  });

  it('shows the server validation next to its field, not in a toast', async () => {
    const user = userEvent.setup();
    create.mockRejectedValueOnce({ isAxiosError: true, response: { status: 400, data: { site_link: ['Use una ruta del sitio o https://.'] } } });
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    await screen.findByText('Junta de padres');
    await user.click(screen.getByRole('button', { name: /Nuevo comunicado/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Título$/i), { target: { value: 'Borrador' } });
    fireEvent.change(within(dialog).getByLabelText(/^Mensaje$/i), { target: { value: 'Texto.' } });
    await user.click(within(dialog).getByLabelText(/^Publicado/i));
    await user.click(within(dialog).getByLabelText(/Publicar en el sitio público/i));
    fireEvent.change(within(dialog).getByLabelText(/Enlace «Ver más»/i), { target: { value: 'ftp://x' } });
    await user.click(within(dialog).getByRole('button', { name: /^Guardar borrador$/i }));
    expect(await within(dialog).findByText('Use una ruta del sitio o https://.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Enlace «Ver más»/i)).toHaveAttribute('aria-invalid', 'true');
    // Typing again clears the message.
    fireEvent.change(within(dialog).getByLabelText(/Enlace «Ver más»/i), { target: { value: '/admisiones' } });
    expect(within(dialog).queryByText('Use una ruta del sitio o https://.')).toBeNull();
  });

  it('shows the push toggle ON by default and posts it OFF when unchecked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    await screen.findByText('Junta de padres');

    await user.click(screen.getByRole('button', { name: /Nuevo comunicado/i }));
    const dialog = await screen.findByRole('dialog');
    const pushToggle = within(dialog).getByLabelText(/Enviar notificación push/i);
    expect(pushToggle).toBeChecked();

    fireEvent.change(within(dialog).getByLabelText(/^Título$/i), {
      target: { value: 'Sin push' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Mensaje$/i), {
      target: { value: 'Aviso silencioso.' },
    });
    await user.click(pushToggle);
    expect(pushToggle).not.toBeChecked();

    await user.click(within(dialog).getByRole('button', { name: /^Publicar$/i }));
    const confirm = within(dialog).getByRole('alertdialog', { name: /¿Enviar ahora\?/i });
    expect(confirm).toHaveTextContent(/en el portal y correo\. No se puede deshacer/);
    await user.click(within(confirm).getByRole('button', { name: /^Enviar ahora$/i }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ push_enabled: false }),
      );
    });
  });

  // Launch review #4: «Publicar» sent to every family on one click.
  it('«Volver» leaves the comunicado unsent, and the confirmation shows the audience size', async () => {
    recipientCount.mockResolvedValue({ data: { count: 640 } } as never);
    const user = userEvent.setup();
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    await screen.findByText('Junta de padres');

    await user.click(screen.getByRole('button', { name: /Nuevo comunicado/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Título$/i), { target: { value: 'Aviso' } });
    fireEvent.change(within(dialog).getByLabelText(/^Mensaje$/i), { target: { value: 'Texto.' } });
    await user.click(within(dialog).getByRole('button', { name: /^Publicar$/i }));

    const confirm = within(dialog).getByRole('alertdialog', { name: /¿Enviar ahora\?/i });
    await waitFor(() => expect(confirm).toHaveTextContent(/~640 familia\(s\)/));
    await user.click(within(confirm).getByRole('button', { name: /^Volver$/i }));
    expect(within(dialog).queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^Publicar$/i })).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('saves a draft without the send confirmation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    await screen.findByText('Junta de padres');

    await user.click(screen.getByRole('button', { name: /Nuevo comunicado/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Título$/i), { target: { value: 'Borrador' } });
    fireEvent.change(within(dialog).getByLabelText(/^Mensaje$/i), { target: { value: 'Texto.' } });
    await user.click(within(dialog).getByLabelText(/^Publicado/i));
    await user.click(within(dialog).getByRole('button', { name: /^Guardar borrador$/i }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ is_active: false })));
    expect(within(dialog).queryByRole('alertdialog')).not.toBeInTheDocument();
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

  it('the WhatsApp blast goes out in the background: the toast says so and the delivery report follows it', async () => {
    const user = userEvent.setup();
    broadcast.mockResolvedValueOnce({
      data: { announcement_id: 9, notified: 12, dispatched: 4, whatsapp_queued: 3, whatsapp_configured: true },
    } as never);
    const report = (whatsapp: Record<string, number>) => ({
      data: { announcement: 9, recipients: 12, pending_dispatch: 8, read: 0, email: { sent: 4, pending: 8, skipped: 0, failed: 0 },
        push: { sent: 0, pending: 8, skipped: 4, failed: 0 }, whatsapp, failed: [] },
    }) as never;
    delivery
      .mockResolvedValueOnce(report({ sent: 1, pending: 2, skipped: 0, failed: 0 }))
      .mockResolvedValue(report({ sent: 3, pending: 0, skipped: 0, failed: 0 }));
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    await screen.findByText('Junta de padres');

    await user.click(screen.getByRole('button', { name: /Aviso urgente/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Título$/i), { target: { value: 'Suspensión' } });
    fireEvent.change(within(dialog).getByLabelText(/^Mensaje$/i), { target: { value: 'No hay clases.' } });
    await user.click(within(dialog).getByLabelText(/También WhatsApp/i));
    await user.click(within(dialog).getByLabelText(/Confirmo que este aviso es urgente/i));
    await user.click(within(dialog).getByRole('button', { name: /Enviar aviso urgente/i }));

    await waitFor(() => expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ whatsapp: true })));
    expect(toastSuccess).toHaveBeenCalledWith(
      'Aviso urgente enviado: 12 notificados, 4 por correo/push. Enviando WhatsApp a 3 contactos…',
    );
    const entrega = await screen.findByRole('dialog', { name: 'Entrega: Suspensión' });
    expect(await within(entrega).findByText('Enviando a 3 contactos… 1 de 3 procesados.')).toBeInTheDocument();
    expect(delivery).toHaveBeenCalledWith(9);
    // Polled while numbers are pending, then the final count.
    expect(await within(entrega).findByText('WhatsApp terminado: 3 de 3 enviados.', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('says so when WhatsApp was asked for but is not configured', async () => {
    const user = userEvent.setup();
    broadcast.mockResolvedValueOnce({
      data: { announcement_id: 9, notified: 12, dispatched: 4, whatsapp_queued: 0, whatsapp_configured: false },
    } as never);
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    await screen.findByText('Junta de padres');
    await user.click(screen.getByRole('button', { name: /Aviso urgente/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Título$/i), { target: { value: 'Alerta' } });
    fireEvent.change(within(dialog).getByLabelText(/^Mensaje$/i), { target: { value: 'Detalle' } });
    await user.click(within(dialog).getByLabelText(/También WhatsApp/i));
    await user.click(within(dialog).getByLabelText(/Confirmo que este aviso es urgente/i));
    await user.click(within(dialog).getByRole('button', { name: /Enviar aviso urgente/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('WhatsApp no configurado: no se envió por WhatsApp.'));
    expect(delivery).not.toHaveBeenCalled();
  });

  it('surfaces backend error text from emergency broadcast', async () => {
    const user = userEvent.setup();
    broadcast.mockRejectedValueOnce({
      response: { status: 400, data: { detail: 'WhatsApp no configurado.' } },
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

  it('maps URL filters and sort onto the list request and marks the sorted header', async () => {
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados?q=junta&estado=0&audiencia=parents&orden=-reads&page=2' });
    await screen.findByText('Junta de padres');
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      page: 2, q: 'junta', active: '0', audience: 'parents', ordering: '-reads',
    }));
    expect(screen.getByRole('columnheader', { name: 'Leídos' })).toHaveAttribute('aria-sort', 'descending');
  });

  it('selects a row, shows the dry-run plan and commits the bulk deactivate', async () => {
    const user = userEvent.setup();
    bulk
      .mockResolvedValueOnce({ data: { action: 'delete', requested: 1, ok: 0, failed: [], skipped: [{ id: 4, reason: 'ya se envió a las familias; desactívelo para archivarlo' }], dry_run: true } } as never);
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    await screen.findByText('Junta de padres');
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar comunicado Junta de padres' }));
    const bar = screen.getByRole('region', { name: 'Acciones en lote' });
    await user.click(within(bar).getByRole('button', { name: 'Más' }));
    await user.click(screen.getByRole('menuitem', { name: /Eliminar no enviados/ }));
    expect(await screen.findByText(/1 porque ya se envió a las familias/)).toBeInTheDocument();
    expect(bulk).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', ids: [4], dry_run: true }));
    expect(screen.getByRole('button', { name: /Eliminar no enviados \(0\)/ })).toBeDisabled();
  });

  it('exports the current view as Excel with the active filters', async () => {
    const user = userEvent.setup();
    exportList.mockResolvedValue({ data: new Blob(['x']) } as never);
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados?audiencia=staff' });
    await screen.findByText('Junta de padres');
    await user.click(screen.getByRole('button', { name: /^Exportar$/ }));
    await user.click(screen.getByRole('menuitem', { name: /Excel/ }));
    await waitFor(() => expect(exportList).toHaveBeenCalledWith(expect.objectContaining({ audience: 'staff', fmt: 'xlsx' })));
  });

  it('asks before «Activar» sends a comunicado that was never sent, then confirms with a toast', async () => {
    const user = userEvent.setup();
    const update = vi.mocked(portalApi.adminUpdateAnnouncement);
    update.mockResolvedValue({ data: {} } as never);
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    const row = await screen.findByRole('row', { name: /Junta de padres/ });
    await user.click(within(row).getByRole('button', { name: 'Activar' }));
    expect(update).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Activar comunicado' });
    expect(dialog).toHaveTextContent('se enviará ahora a: padres');
    await user.click(within(dialog).getByRole('button', { name: 'Activar y enviar' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(4, { is_active: true }));
    expect(toastSuccess).toHaveBeenCalledWith('Comunicado activado y enviado.');
  });

  it('does not offer «Enterado» or attachments, and warns past 280 characters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    await screen.findByText('Junta de padres');
    await user.click(screen.getByRole('button', { name: /Nuevo comunicado/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/Enterado/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Adjuntos (máx. 10)')).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Mensaje$/i), { target: { value: 'x'.repeat(300) } });
    expect(within(dialog).getByText(/solo reciben los primeros 280/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText(/^Publicado/));
    expect(within(dialog).getByRole('button', { name: 'Guardar borrador' })).toBeInTheDocument();
  });

  it('says «Borrador guardado» (not «publicado») for an inactive comunicado', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    await screen.findByText('Junta de padres');
    await user.click(screen.getByRole('button', { name: /Nuevo comunicado/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Título$/i), { target: { value: 'Borrador' } });
    fireEvent.change(within(dialog).getByLabelText(/^Mensaje$/i), { target: { value: 'Texto.' } });
    fireEvent.click(within(dialog).getByLabelText(/^Publicado/));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ is_active: false })));
    expect(toastSuccess).toHaveBeenCalledWith('Borrador guardado (no se envía hasta activarlo).');
  });

  it('Comunicados staff write notices but never the emergency broadcast', async () => {
    useAuthStore.setState({ user: { ...ADMIN, role: 'staff', staff_areas: ['comunicados'] }, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados?emergencia=1' });
    expect(await screen.findByRole('button', { name: /Nuevo comunicado/ })).toBeInTheDocument();
    // Shown, disabled, with the reason (UX Phase 7); clicking opens nothing.
    const restricted = screen.getByRole('button', { name: /Aviso urgente/i });
    expect(restricted).toHaveAttribute('aria-disabled', 'true');
    expect(restricted).toHaveAccessibleDescription('Solo administradores');
    fireEvent.click(restricted);
    expect(screen.queryByRole('dialog', { name: /Aviso urgente/ })).not.toBeInTheDocument();
  });

  it('«Enviar ahora» sends once for a double click and stays busy while it runs', async () => {
    const user = userEvent.setup();
    let resolve: (v: unknown) => void = () => {};
    create.mockImplementationOnce(() => new Promise((r) => { resolve = r; }) as never);
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    await screen.findByText('Junta de padres');
    await user.click(screen.getByRole('button', { name: /Nuevo comunicado/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Título$/i), { target: { value: 'Suspensión' } });
    fireEvent.change(within(dialog).getByLabelText(/^Mensaje$/i), { target: { value: 'No hay clases.' } });
    await user.click(within(dialog).getByRole('button', { name: /^Publicar$/i }));
    const sendNow = within(dialog).getByRole('button', { name: /^Enviar ahora$/i });
    fireEvent.click(sendNow);
    fireEvent.click(sendNow);
    await waitFor(() => expect(create).toHaveBeenCalled());
    await waitFor(() => expect(sendNow).toBeDisabled());
    expect(within(dialog).getByRole('button', { name: /^Volver$/i })).toBeDisabled();
    resolve({ data: {} });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Comunicado publicado y enviado.'));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('«Enviar aviso urgente» sends once for a double click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
    await screen.findByText('Junta de padres');
    await user.click(screen.getByRole('button', { name: /Aviso urgente/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Título$/i), { target: { value: 'Contingencia' } });
    fireEvent.change(within(dialog).getByLabelText(/^Mensaje$/i), { target: { value: 'Sin clases.' } });
    await user.click(within(dialog).getByLabelText(/Confirmo que este aviso es urgente/i));
    const send = within(dialog).getByRole('button', { name: /Enviar aviso urgente/i });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  describe('unsaved changes', () => {
    it('closes an untouched composer without asking', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
      await screen.findByText('Junta de padres');
      await user.click(screen.getByRole('button', { name: /Nuevo comunicado/i }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('asks before closing a composer with text; «Descartar cambios» closes it', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
      await screen.findByText('Junta de padres');
      await user.click(screen.getByRole('button', { name: /Nuevo comunicado/i }));
      const dialog = await screen.findByRole('dialog', { name: 'Nuevo comunicado' });
      fireEvent.change(within(dialog).getByLabelText(/^Título$/i), { target: { value: 'Borrador' } });
      await user.keyboard('{Escape}');
      const ask = screen.getByRole('dialog', { name: '¿Descartar los cambios?' });
      await user.click(within(ask).getByRole('button', { name: 'Seguir editando' }));
      expect(within(dialog).getByLabelText(/^Título$/i)).toHaveValue('Borrador');
      await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
      await user.click(screen.getByRole('button', { name: 'Descartar cambios' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does not ask after the comunicado was saved', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminAnnouncements />, { route: '/admin/comunicados' });
      await screen.findByText('Junta de padres');
      await user.click(screen.getByRole('button', { name: /Nuevo comunicado/i }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByLabelText(/^Publicado/i));
      fireEvent.change(within(dialog).getByLabelText(/^Título$/i), { target: { value: 'Borrador' } });
      fireEvent.change(within(dialog).getByLabelText(/^Mensaje$/i), { target: { value: 'Texto.' } });
      await user.click(within(dialog).getByRole('button', { name: /Guardar borrador/i }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.queryByText('¿Descartar los cambios?')).toBeNull();
    });
  });
});
