import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import AdminVisitsWeek, { localISODate, mondayOf, shiftWeek, weekEnd } from './AdminVisitsWeek';
import { api, bookingsApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({
  api: { get: vi.fn() },
  bookingsApi: {
    adminWeek: vi.fn().mockResolvedValue({ data: { start: '2026-08-24', end: '2026-08-30', days: [
      { date: '2026-08-24', slots: [{ id: 1, title: 'Clase abierta', visit_type: 'open_class', start_time: '09:00', end_time: '10:30', capacity: 12, is_active: true, booked: 2, bookings: [
        { id: 5, parent_name: 'María', child_name: 'Ana', status: 'confirmed', outcome: '', num_attendees: 2, parent_phone: '5512345678', case: 7 },
      ] }] },
      ...[25, 26, 27, 28, 29, 30].map((d) => ({ date: `2026-08-${d}`, slots: [] })),
    ] } }),
    adminReschedule: vi.fn(), adminOutcome: vi.fn(), bookingAction: vi.fn(),
  },
}));

const EXAMS = {
  from: '2026-08-24', to: '2026-08-30',
  days: [
    { date: '2026-08-24', exams: [] },
    { date: '2026-08-25', exams: [{ case: 9, child_name: 'Lucía Prueba', parent_name: 'Marta', parent_phone: '5512345678', grade_applying: '2° Primaria', level: 'primaria', exam_at: '2026-08-25T15:00:00Z', time: '09:00', exam_notes: '', exam_results_at: null, result: '', stage: 'examen', date_sent_at: null }] },
    ...[26, 27, 28, 29, 30].map((d) => ({ date: `2026-08-${d}`, exams: [] })),
  ],
};

describe('AdminVisitsWeek', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockResolvedValue({ data: EXAMS } as never);
    useAuthStore.setState({ user: { id: 1, role: 'admin' } as never, isAuthenticated: true });
  });

  it('week helpers', () => {
    expect(mondayOf(new Date('2026-08-27T12:00:00'))).toBe('2026-08-24');
    expect(shiftWeek('2026-08-24', 1)).toBe('2026-08-31');
    expect(weekEnd('2026-08-24')).toBe('2026-08-30');
  });

  it('shows the admission exams in the grid with their own colour and legend; both open the Expediente', async () => {
    renderWithProviders(<AdminVisitsWeek />, { route: '/admin/visitas/semana' });
    const exam = await screen.findByRole('link', { name: /09:00 · Examen.*Lucía Prueba/ });
    expect(exam).toHaveAttribute('href', '/admin/admisiones/9');
    expect(exam.className).toContain('bg-pink-light');
    expect(screen.getByRole('list', { name: 'Simbología' })).toHaveTextContent('Examen de admisión');
    expect(screen.getByRole('link', { name: 'Expediente de Ana' })).toHaveAttribute('href', '/admin/admisiones/7');
    expect(api.get).toHaveBeenCalledWith('/admissions/admin/exams/', { params: { from: mondayOf(new Date()), to: weekEnd(mondayOf(new Date())) } });
  });

  it('a Visitas-only account sees the visits without exams', async () => {
    useAuthStore.setState({ user: { id: 2, role: 'staff', staff_areas: ['visitas'] } as never, isAuthenticated: true });
    renderWithProviders(<AdminVisitsWeek />, { route: '/admin/visitas/semana' });
    expect(await screen.findByText(/María · Ana/)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: 'Simbología' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Expediente de Ana' })).not.toBeInTheDocument();
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
  it('a visit still to come offers no «No asistió» and no «Resultado», only «Reprogramar» (QA 2026-11-24)', async () => {
    vi.mocked(bookingsApi.adminWeek).mockResolvedValueOnce({ data: { start: '2099-06-15', end: '2099-06-21', days: [
      { date: '2099-06-15', slots: [{ id: 2, title: '', visit_type: 'individual', start_time: '09:00', end_time: '09:30', capacity: 1, is_active: true, booked: 1, bookings: [
        { id: 8, parent_name: 'Rosa', child_name: 'Leo', status: 'confirmed', outcome: '', num_attendees: 1, parent_phone: '', case: null },
      ] }] },
      ...[16, 17, 18, 19, 20, 21].map((d) => ({ date: `2099-06-${d}`, slots: [] })),
    ] } } as never);
    renderWithProviders(<AdminVisitsWeek />, { route: '/admin/visitas/semana' });
    expect(await screen.findByText(/Rosa · Leo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reprogramar/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'No asistió' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Resultado/ })).toBeNull();
  });
});
