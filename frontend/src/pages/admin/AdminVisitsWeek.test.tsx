import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import AdminVisitsWeek, { localISODate, mondayOf, shiftWeek } from './AdminVisitsWeek';
import { bookingsApi } from '@/services/api';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({
  bookingsApi: {
    adminWeek: vi.fn().mockResolvedValue({ data: { start: '2026-08-24', end: '2026-08-30', days: [
      { date: '2026-08-24', slots: [{ id: 1, title: 'Clase abierta', visit_type: 'open_class', start_time: '09:00', end_time: '10:30', capacity: 12, is_active: true, booked: 2, bookings: [
        { id: 5, parent_name: 'María', child_name: 'Ana', status: 'confirmed', outcome: '', num_attendees: 2, parent_phone: '5512345678' },
      ] }] },
      ...[25, 26, 27, 28, 29, 30].map((d) => ({ date: `2026-08-${d}`, slots: [] })),
    ] } }),
    adminReschedule: vi.fn(), adminOutcome: vi.fn(), bookingAction: vi.fn(),
  },
}));

describe('AdminVisitsWeek', () => {
  it('week helpers', () => {
    expect(mondayOf(new Date('2026-08-27T12:00:00'))).toBe('2026-08-24');
    expect(shiftWeek('2026-08-24', 1)).toBe('2026-08-31');
  });
  it('renders the 7 days with bookings and actions', async () => {
    renderWithProviders(<AdminVisitsWeek />, { route: '/admin/visitas/semana' });
    expect(await screen.findByText(/María · Ana/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem', { name: /Lun|Mar|Mié|Jue|Vie|Sáb|Dom/ })).toHaveLength(7);
    expect(screen.getByRole('button', { name: /Reprogramar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resultado/ })).toBeInTheDocument();
  });
  it('uses the local calendar date, not UTC (evening in Mexico is already tomorrow in UTC)', () => {
    const lateEvening = new Date(2026, 7, 30, 23, 30); // Sunday 30 Aug, 23:30 local
    expect(localISODate(lateEvening)).toBe('2026-08-30');
    expect(mondayOf(lateEvening)).toBe('2026-08-24');
  });
  it('asks before «No asistió», then confirms with a toast', async () => {
    const toast = (await import('react-hot-toast')).default;
    vi.mocked(bookingsApi.bookingAction).mockResolvedValue({ data: {} } as never);
    renderWithProviders(<AdminVisitsWeek />, { route: '/admin/visitas/semana' });
    await userEvent.click(await screen.findByRole('button', { name: 'No asistió' }));
    expect(bookingsApi.bookingAction).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Marcar «No asistió»' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Marcar «No asistió»' }));
    await waitFor(() => expect(bookingsApi.bookingAction).toHaveBeenCalledWith(5, 'no_show'));
    expect(toast.success).toHaveBeenCalledWith('Visita marcada como «No asistió».');
  });
});
