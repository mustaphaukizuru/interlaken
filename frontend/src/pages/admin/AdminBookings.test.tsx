import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';

vi.mock('@/services/api', async () => ({
  ...(await vi.importActual<typeof import('@/services/dataOps')>('@/services/dataOps')),
  downloadBlob: vi.fn(),
  bookingsApi: {
    getAdminBookings: vi.fn(),
    exportBookings: vi.fn(),
    bookingAction: vi.fn(),
    bulkBookings: vi.fn(),
    getAdminSlots: vi.fn(),
    exportSlots: vi.fn(),
    bulkSlots: vi.fn(),
    generateSlots: vi.fn(),
    updateSlot: vi.fn(),
    deleteSlot: vi.fn(),
    slotsImportTemplate: vi.fn(),
    slotsImportUpload: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 't1') },
}));

import toast from 'react-hot-toast';
import AdminBookings from './AdminBookings';
import { bookingsApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';

const api = vi.mocked(bookingsApi);

const booking = (id: number, name: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, slot: 1, visit_type: 'individual', slot_date: '2026-10-15', slot_start_time: '09:00:00', slot_end_time: '09:30:00',
  slot_location: 'Campus', parent_name: name, parent_email: `${name.toLowerCase()}@test.mx`, parent_phone: '5512345678',
  child_name: 'Lucía', child_grade: '1° primaria', num_attendees: 2, status, source: 'web', confirmation_sent: false,
  created_at: '2026-09-20T10:00:00Z', ...extra,
});

const BOOKINGS = [
  booking(1, 'Ana', 'pending'),
  booking(2, 'Beto', 'confirmed'),
  booking(3, 'Carla', 'cancelled'),
  booking(4, 'Dani', 'no_show'),
];

const SLOTS = [
  { id: 7, visit_type: 'open_class', title: 'Puertas Abiertas', date: '2026-10-20', start_time: '09:00:00', end_time: '11:00:00', capacity: 30, location: 'Auditorio', is_active: true, booked_count: 4, spots_remaining: 26, is_full: false },
];

const page = <T,>(results: T[]) => ({ data: { count: results.length, next: null, previous: null, results } });

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  api.getAdminBookings.mockResolvedValue(page(BOOKINGS) as never);
  api.getAdminSlots.mockResolvedValue(page(SLOTS) as never);
  api.bookingAction.mockResolvedValue({ data: {} } as never);
  api.exportBookings.mockResolvedValue({ data: new Blob(['x']) } as never);
  api.bulkBookings.mockImplementation(async (body) => ({
    data: { action: body.action, requested: body.ids.length, ok: body.ids.length, failed: [], skipped: [], dry_run: !!body.dry_run },
  }) as never);
  api.bulkSlots.mockImplementation(async (body) => ({
    data: { action: body.action, requested: body.ids.length, ok: 0, failed: [], skipped: body.ids.map((id) => ({ id, reason: 'Tiene 1 reserva(s).' })), dry_run: !!body.dry_run },
  }) as never);
  api.generateSlots.mockResolvedValue({ data: { created: 2, skipped: 0, detail: '2 horarios generados (0 ya existían).' } } as never);
});

describe('AdminBookings: reservas', () => {
  it('maps every URL filter, the sort and the page onto the list request', async () => {
    renderWithProviders(<AdminBookings />, {
      route: '/admin/visitas?q=ana&estado=pending&tipo=open_class&origen=whatsapp&desde=2026-10-01&hasta=2026-10-31&orden=-attendees&page=2',
    });
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(api.getAdminBookings).toHaveBeenCalledWith({
      page: 2, q: 'ana', status: 'pending', type: 'open_class', source: 'whatsapp', from: '2026-10-01', to: '2026-10-31', ordering: '-attendees',
    });
    expect(screen.getByRole('columnheader', { name: 'Asistentes' })).toHaveAttribute('aria-sort', 'descending');
    expect(api.getAdminSlots).not.toHaveBeenCalled();
  });

  it('defaults to all visit types (clean URL = no filter)', async () => {
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findByText('Ana');
    expect(api.getAdminBookings).toHaveBeenCalledWith({ page: 1 });
  });

  it('writes the type filter to the URL and refetches', async () => {
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findByText('Ana');
    await userEvent.selectOptions(screen.getByLabelText('Tipo de visita'), 'open_class');
    await waitFor(() => expect(api.getAdminBookings).toHaveBeenCalledWith({ page: 1, type: 'open_class' }));
  });

  it('offers only the moves the transition table allows, including no-show', async () => {
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findByText('Ana');
    // pending: confirm, attended, no_show, cancel; no reopen.
    expect(screen.getByRole('button', { name: 'Confirmar la reserva de Ana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar que Ana no asistió' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reabrir la reserva de Ana' })).not.toBeInTheDocument();
    // confirmed: no confirm; no-show is available (it used to exist only in the week view).
    expect(screen.queryByRole('button', { name: 'Confirmar la reserva de Beto' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Marcar que Beto no asistió' }));
    await waitFor(() => expect(api.bookingAction).toHaveBeenCalledWith(2, 'no_show', {}));
    // cancelled: only reopen.
    expect(screen.queryByRole('button', { name: 'Confirmar la reserva de Carla' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reabrir la reserva de Carla' })).toBeInTheDocument();
  });

  it('reopen and the no-show correction ask for a note and send it', async () => {
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findByText('Carla');
    await userEvent.click(screen.getByRole('button', { name: 'Reabrir la reserva de Carla' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reabrir reserva' });
    const submit = within(dialog).getByRole('button', { name: 'Reabrir' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'La familia llamó');
    await userEvent.click(submit);
    await waitFor(() => expect(api.bookingAction).toHaveBeenCalledWith(3, 'reopen', { note: 'La familia llamó' }));

    await userEvent.click(screen.getByRole('button', { name: 'Marcar que Dani asistió' }));
    const fix = await screen.findByRole('dialog', { name: 'Corregir: sí asistió' });
    await userEvent.type(within(fix).getByLabelText(/Motivo/), 'Llegó tarde');
    await userEvent.click(within(fix).getByRole('button', { name: 'Marcar asistió' }));
    await waitFor(() => expect(api.bookingAction).toHaveBeenCalledWith(4, 'attended', { note: 'Llegó tarde' }));
  });

  it('shows the server reason when a move is refused (capacity)', async () => {
    api.bookingAction.mockRejectedValueOnce({ isAxiosError: true, response: { status: 400, data: { detail: 'El horario ya no tiene cupo suficiente.' } } });
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findByText('Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar la reserva de Ana' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('El horario ya no tiene cupo suficiente.'));
  });

  it('bulk confirm runs a dry run first, then commits with notify', async () => {
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas?estado=pending' });
    await screen.findByText('Ana');
    await userEvent.click(screen.getByRole('checkbox', { name: /Seleccionar reserva de Ana/ }));
    const bar = await screen.findByRole('region', { name: 'Acciones en lote' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(api.bulkBookings).toHaveBeenCalledWith(expect.objectContaining({ action: 'confirm', ids: [1], dry_run: true })));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Se confirmarán');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Confirmar/ }));
    await waitFor(() => expect(api.bulkBookings).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'confirm', ids: [1], dry_run: false, payload: expect.objectContaining({ notify: true }),
    })));
  });

  it('exports the current view with the same filters', async () => {
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas?q=ana&estado=confirmed&orden=parent' });
    await screen.findByText('Ana');
    await userEvent.click(screen.getByRole('button', { name: /^Exportar$/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Excel/ }));
    await waitFor(() => expect(api.exportBookings).toHaveBeenCalledWith({
      q: 'ana', status: 'confirmed', ordering: 'parent', fmt: 'xlsx', ids: undefined,
    }));
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findByText('Ana');
    const results = await axe(container);
    expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
  });
});

describe('AdminBookings: horarios', () => {
  const ROUTE = '/admin/visitas?vista=horarios';

  it('lists slots with their URL filters and switches views with a clean URL', async () => {
    renderWithProviders(<AdminBookings />, { route: `${ROUTE}&tipo=open_class&activo=true&orden=-booked` });
    expect(await screen.findByText('Auditorio')).toBeInTheDocument();
    expect(api.getAdminSlots).toHaveBeenCalledWith({ page: 1, type: 'open_class', active: 'true', ordering: '-booked' });
    await userEvent.click(screen.getByRole('tab', { name: 'Reservas' }));
    await waitFor(() => expect(api.getAdminBookings).toHaveBeenCalledWith({ page: 1 }));
  });

  it('publishes Puertas Abiertas slots with open_class + title', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminBookings />, { route: ROUTE });
    await screen.findByText('Auditorio');
    await user.selectOptions(screen.getByLabelText('Tipo de visita a publicar'), 'open_class');
    expect(screen.getByLabelText(/Nombre del evento/i)).toHaveValue('Puertas Abiertas');
    // The generator form has its own Desde/Hasta (the slot filter bar has another pair).
    const form = screen.getByRole('button', { name: /Publicar eventos/i }).closest('form') as HTMLElement;
    fireEvent.change(within(form).getByLabelText(/^Desde$/i), { target: { value: '2026-09-01' } });
    fireEvent.change(within(form).getByLabelText(/^Hasta$/i), { target: { value: '2026-09-01' } });
    await user.click(screen.getByRole('button', { name: /Publicar eventos/i }));
    await waitFor(() => expect(api.generateSlots).toHaveBeenCalledWith(expect.objectContaining({
      visit_type: 'open_class', title: 'Puertas Abiertas', capacity: 30, interval_minutes: 120, start_date: '2026-09-01', end_date: '2026-09-01',
    })));
    expect(toast.success).toHaveBeenCalled();
  });

  it('bulk delete shows the per-row reason why a booked slot is skipped', async () => {
    renderWithProviders(<AdminBookings />, { route: ROUTE });
    await screen.findByText('Auditorio');
    await userEvent.click(screen.getByRole('checkbox', { name: /Seleccionar horario del/ }));
    const bar = await screen.findByRole('region', { name: 'Acciones en lote' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Eliminar' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveTextContent('Tiene 1 reserva(s).'));
    expect(api.bulkSlots).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', ids: [7], dry_run: true }));
  });

  it('opens the import dialog with the slot template headers', async () => {
    renderWithProviders(<AdminBookings />, { route: ROUTE });
    await screen.findByText('Auditorio');
    await userEvent.click(screen.getByRole('button', { name: /Cargar horarios/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Cargar horarios de visita' });
    expect(dialog).toHaveTextContent('cupo');
    expect(dialog).toHaveTextContent('DD/MM/AAAA');
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = renderWithProviders(<AdminBookings />, { route: ROUTE });
    await screen.findByText('Auditorio');
    const results = await axe(container);
    expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
  });
});
