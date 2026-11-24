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
    // pending: «Confirmar» is the visible step; attended, no_show and cancel wait in «⋯»; no reopen.
    expect(screen.getByRole('button', { name: 'Confirmar la reserva de Ana' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones para la reserva de Ana' }));
    const anaMenu = screen.getByRole('menu', { name: 'Más acciones para la reserva de Ana' });
    expect(within(anaMenu).getAllByRole('menuitem').map((m) => m.getAttribute('aria-label'))).toEqual([
      'Marcar que Ana asistió', 'Marcar que Ana no asistió', 'Cancelar la reserva de Ana',
    ]);
    expect(screen.queryByRole('menuitem', { name: 'Reabrir la reserva de Ana' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    // confirmed: no confirm; «Asistió» is visible, no-show (it used to exist only in the week view) is in «⋯».
    expect(screen.queryByRole('button', { name: 'Confirmar la reserva de Beto' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar que Beto asistió' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones para la reserva de Beto' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Marcar que Beto no asistió' }));
    await waitFor(() => expect(api.bookingAction).toHaveBeenCalledWith(2, 'no_show', {}));
    // cancelled: only reopen, visible, and no «⋯» with nothing in it.
    expect(screen.queryByRole('button', { name: 'Confirmar la reserva de Carla' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reabrir la reserva de Carla' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Más acciones para la reserva de Carla' })).not.toBeInTheDocument();
  });

  it('a visit still to come offers no «Asistió» / «No asistió» (QA 2026-11-24)', async () => {
    api.getAdminBookings.mockResolvedValue(page([
      booking(5, 'Eva', 'pending', { slot_date: '2099-06-15' }),
      booking(6, 'Fer', 'confirmed', { slot_date: '2099-06-15' }),
    ]) as never);
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findByText('Eva');
    expect(screen.getByRole('button', { name: 'Confirmar la reserva de Eva' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones para la reserva de Eva' }));
    expect(within(screen.getByRole('menu', { name: 'Más acciones para la reserva de Eva' })).getAllByRole('menuitem')
      .map((m) => m.getAttribute('aria-label'))).toEqual(['Cancelar la reserva de Eva']);
    await userEvent.keyboard('{Escape}');
    // Confirmed and not started: cancelling is the only move.
    expect(screen.queryByRole('button', { name: 'Marcar que Fer asistió' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Marcar que Fer no asistió' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancelar la reserva de Fer' })).toBeInTheDocument();
  });

  it('the cancel dialog reads «Volver» / «Cancelar la visita» and says the family gets an email (QA 2026-11-24)', async () => {
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findByText('Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones para la reserva de Ana' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cancelar la reserva de Ana' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancelar la visita' });
    expect(dialog).toHaveTextContent('La familia recibirá un correo con la cancelación.');
    expect(within(dialog).queryByRole('button', { name: /^Cancelar$/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Volver' }));
    expect(api.bookingAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones para la reserva de Ana' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cancelar la reserva de Ana' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Cancelar la visita' })).getByRole('button', { name: 'Cancelar la visita' }));
    await waitFor(() => expect(api.bookingAction).toHaveBeenCalledWith(1, 'cancel', {}));
  });

  it('«Confirmar» (emails the family) runs once for a double click, and the row stays busy while another row works', async () => {
    let resolveAna: (v: unknown) => void = () => {};
    api.bookingAction.mockImplementationOnce(() => new Promise((r) => { resolveAna = r; }) as never);
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findByText('Ana');
    const confirmAna = screen.getByRole('button', { name: 'Confirmar la reserva de Ana' });
    fireEvent.click(confirmAna);
    fireEvent.click(confirmAna);
    await waitFor(() => expect(api.bookingAction).toHaveBeenCalledWith(1, 'confirm', {}));
    await waitFor(() => expect(confirmAna).toBeDisabled());
    // Another row moves meanwhile: Ana's button stays busy.
    fireEvent.click(screen.getByRole('button', { name: 'Marcar que Beto asistió' }));
    await waitFor(() => expect(api.bookingAction).toHaveBeenCalledWith(2, 'attended', {}));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Reserva actualizada.'));
    expect(confirmAna).toBeDisabled();
    resolveAna({ data: {} });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
    expect(api.bookingAction.mock.calls.filter(([id]) => id === 1)).toHaveLength(1);
  });

  it('below lg every move is a labelled button in the row menu, with the same names', async () => {
    stubViewport(800);
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findAllByText('Ana');
    await userEvent.click(screen.getByRole('button', { name: /^Acciones de reserva de Ana/ }));
    for (const name of ['Confirmar la reserva de Ana', 'Marcar que Ana asistió', 'Marcar que Ana no asistió', 'Cancelar la reserva de Ana']) {
      expect(screen.getByRole('button', { name })).toBeVisible();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Marcar que Ana asistió' }));
    await waitFor(() => expect(api.bookingAction).toHaveBeenCalledWith(1, 'attended', {}));
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

  it('«Deshacer asistencia» returns a marked visit to «Confirmada» with a note and no email (QA 2026-11-24)', async () => {
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findByText('Dani');
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones para la reserva de Dani' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Deshacer la asistencia de Dani' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deshacer asistencia' });
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'Marcado por error');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Volver a «Confirmada»' }));
    await waitFor(() => expect(api.bookingAction).toHaveBeenCalledWith(4, 'confirm', { note: 'Marcado por error', notify: false }));
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
    // One row: the verb agrees (QA 2026-11-24).
    expect(dialog).toHaveTextContent('Se confirmará 1 reserva.');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Confirmar/ }));
    await waitFor(() => expect(api.bulkBookings).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'confirm', ids: [1], dry_run: false, payload: expect.objectContaining({ notify: true }),
    })));
  });

  it('bulk «Asistió» over a «No asistió» visit asks for the note, sends it and names each row in the result', async () => {
    // Dry run: Ana is a plain move, Dani (no_show) a correction. Commit: Ana
    // goes through, Dani fails (as the server would without a note).
    api.bulkBookings.mockImplementation(async (body) => ({
      data: body.dry_run
        ? { action: 'attended', requested: 2, ok: 2, failed: [], skipped: [], dry_run: true, outcomes: { correction: 1 } }
        : { action: 'attended', requested: 2, ok: 1, failed: [{ id: 4, error: 'El horario ya no tiene cupo suficiente.' }], skipped: [], dry_run: false, outcomes: {} },
    }) as never);
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findByText('Ana');
    await userEvent.click(screen.getByRole('checkbox', { name: /Seleccionar reserva de Ana/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Seleccionar reserva de Dani/ }));
    const bar = await screen.findByRole('region', { name: 'Acciones en lote' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Asistió' }));
    const dialog = await screen.findByRole('dialog');
    const note = await within(dialog).findByLabelText('Motivo (obligatorio)');
    expect(within(dialog).getByRole('note')).toHaveTextContent('1 de estas reservas ya está marcada como «No asistió». Cambiarla a «Asistió» es una corrección');
    const commit = within(dialog).getByRole('button', { name: 'Asistió (2)' });
    expect(commit).toBeDisabled();
    await userEvent.type(note, 'Se registró antes de que llegara');
    await userEvent.click(commit);
    await waitFor(() => expect(api.bulkBookings).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'attended', ids: [1, 4], dry_run: false, payload: { note: 'Se registró antes de que llegara' },
    })));
    const failed = await within(dialog).findByRole('list', { name: 'Filas fallidas' });
    expect(failed).toHaveTextContent('Dani (15 oct 2026)El horario ya no tiene cupo suficiente.');
  });

  it('bulk «Asistió» with no correction in the selection asks for nothing', async () => {
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findByText('Ana');
    await userEvent.click(screen.getByRole('checkbox', { name: /Seleccionar reserva de Ana/ }));
    const bar = await screen.findByRole('region', { name: 'Acciones en lote' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Asistió' }));
    const dialog = await screen.findByRole('dialog');
    const commit = await within(dialog).findByRole('button', { name: 'Asistió (1)' });
    expect(within(dialog).queryByLabelText('Motivo (obligatorio)')).not.toBeInTheDocument();
    await userEvent.click(commit);
    await waitFor(() => expect(api.bulkBookings).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'attended', ids: [1], dry_run: false, payload: {},
    })));
  });

  it('at 1280 px the contact goes under the tutor (no sideways scroll); at 1440 it has its column', async () => {
    const { unmount } = renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findByText('Ana');
    expect(screen.queryByRole('columnheader', { name: 'Contacto' })).not.toBeInTheDocument();
    const anaRow = screen.getByRole('row', { name: /Ana/ });
    const tutor = within(anaRow).getAllByRole('cell').find((c) => c.textContent?.startsWith('Ana'))!;
    expect(tutor).toHaveTextContent('Anaana@test.mx5512345678');
    unmount();

    stubViewport(1440);
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findByText('Ana');
    expect(screen.getByRole('columnheader', { name: 'Contacto' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Tutor/ })).toBeInTheDocument();
  });

  it('phone cards keep a Contacto line of their own', async () => {
    stubViewport(390);
    renderWithProviders(<AdminBookings />, { route: '/admin/visitas' });
    await screen.findAllByText('Ana');
    const contact = document.querySelector('td[data-label="Contacto"]');
    expect(contact).toHaveTextContent('ana@test.mx');
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
    // Open-class events are not bookable online (Puertas Abiertas page retired): the form says so.
    expect(screen.getByRole('note')).toHaveTextContent('no pueden reservar estos eventos en línea');
    // The generator form has its own Desde/Hasta (the slot filter bar has another pair).
    const form = screen.getByRole('button', { name: /Crear eventos/i }).closest('form') as HTMLElement;
    fireEvent.change(within(form).getByLabelText(/^Desde$/i), { target: { value: '2026-09-01' } });
    fireEvent.change(within(form).getByLabelText(/^Hasta$/i), { target: { value: '2026-09-01' } });
    await user.click(screen.getByRole('button', { name: /Crear eventos/i }));
    await waitFor(() => expect(api.generateSlots).toHaveBeenCalledWith(expect.objectContaining({
      visit_type: 'open_class', title: 'Puertas Abiertas', capacity: 30, interval_minutes: 120, start_date: '2026-09-01', end_date: '2026-09-01',
    })));
    expect(toast.success).toHaveBeenCalled();
  });

  it('asks before switching tabs with «Publicar disponibilidad» half filled in; not after generating', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminBookings />, { route: ROUTE });
    await screen.findByText('Auditorio');
    const form = screen.getByRole('button', { name: /Generar horarios/i }).closest('form') as HTMLElement;
    fireEvent.change(within(form).getByLabelText(/^Desde$/i), { target: { value: '2026-09-01' } });

    await user.click(screen.getByRole('tab', { name: 'Reservas' }));
    const ask = screen.getByRole('dialog', { name: '¿Descartar los cambios?' });
    await user.click(within(ask).getByRole('button', { name: 'Seguir editando' }));
    expect(screen.getByRole('tab', { name: 'Horarios' })).toHaveAttribute('aria-selected', 'true');
    expect(within(form).getByLabelText(/^Desde$/i)).toHaveValue('2026-09-01');

    // Generated = saved: the tab switch no longer asks.
    fireEvent.change(within(form).getByLabelText(/^Hasta$/i), { target: { value: '2026-09-02' } });
    await user.click(screen.getByRole('button', { name: /Generar horarios/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await user.click(screen.getByRole('tab', { name: 'Reservas' }));
    expect(screen.queryByRole('dialog', { name: '¿Descartar los cambios?' })).toBeNull();
    await waitFor(() => expect(api.getAdminBookings).toHaveBeenCalled());
  });

  it('«Descartar cambios» switches the tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminBookings />, { route: ROUTE });
    await screen.findByText('Auditorio');
    await user.selectOptions(screen.getByLabelText('Tipo de visita a publicar'), 'open_class');
    await user.click(screen.getByRole('tab', { name: 'Reservas' }));
    await user.click(screen.getByRole('button', { name: 'Descartar cambios' }));
    await waitFor(() => expect(api.getAdminBookings).toHaveBeenCalledWith({ page: 1 }));
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
