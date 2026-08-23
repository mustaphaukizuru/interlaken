import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import AdminArco, { deadlineLabel } from './AdminArco';

vi.mock('@/services/api', () => ({
  legalApi: {
    adminListArco: vi.fn().mockResolvedValue({ data: [
      { id: 1, requester_email: 'a@x.mx', requester_name: 'Mamá López', channel: 'email', request_type: 'rectification', details: 'Teléfono', status: 'received', resolution_note: '', statutory_deadline: '2026-09-20', created_at: '2026-08-22T10:00:00Z', resolved_at: null, is_overdue: false, days_left: 12 },
      { id: 2, requester_email: 'b@x.mx', requester_name: '', channel: 'portal', request_type: 'access', details: '', status: 'in_review', resolution_note: '', statutory_deadline: '2026-08-01', created_at: '2026-07-01T10:00:00Z', resolved_at: null, is_overdue: true, days_left: -21 },
    ] }),
    adminSetArcoStatus: vi.fn(), adminIntakeArco: vi.fn(),
  },
}));

describe('AdminArco', () => {
  it('deadlineLabel', () => {
    expect(deadlineLabel({ status: 'received', days_left: 3, is_overdue: false })).toBe('3 d restantes');
    expect(deadlineLabel({ status: 'in_review', days_left: -2, is_overdue: true })).toBe('Vencida hace 2 d');
    expect(deadlineLabel({ status: 'resolved', days_left: 0, is_overdue: false })).toBe('Cerrada');
  });
  it('lists open requests and flags overdue ones', async () => {
    renderWithProviders(<AdminArco />, { route: '/admin/arco' });
    expect(await screen.findByText(/Rectificación · Mamá López/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('1 solicitud vencida');
    expect(screen.getByText('Vencida hace 21 d')).toBeInTheDocument();
  });
});
