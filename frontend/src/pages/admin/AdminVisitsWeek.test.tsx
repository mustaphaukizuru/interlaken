import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import AdminVisitsWeek, { mondayOf, shiftWeek } from './AdminVisitsWeek';

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
});
