import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

vi.mock('@/services/api', () => ({
  financeApi: {
    getStudentLedger: vi.fn(),
  },
}));

vi.mock('@/components/admin/StudentGuardians', () => ({
  StudentGuardians: ({ studentId }: { studentId: number }) => (
    <div data-testid="student-guardians">{studentId}</div>
  ),
}));

vi.mock('@/components/admin/StudentDiscounts', () => ({
  StudentDiscounts: ({ studentId }: { studentId: number }) => (
    <div data-testid="student-discounts">{studentId}</div>
  ),
}));

import AdminStudentDetail from './AdminStudentDetail';
import { financeApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const getStudentLedger = vi.mocked(financeApi.getStudentLedger);

const LEDGER = {
  student: {
    id: 7,
    name: 'Luis López',
    student_code: 'A-007',
    grade: '3° A',
  },
  outstanding: '2500.50',
  invoices: [
    {
      id: 11,
      period_label: 'Agosto 2026',
      amount: '2500.50',
      balance_due: '2500.50',
      currency: 'MXN',
      status: 'pending',
      due_date: '2026-08-10',
    },
    {
      id: 12,
      period_label: 'Julio 2026',
      amount: '2500.00',
      balance_due: '0.00',
      currency: 'MXN',
      status: 'paid',
      due_date: '2026-07-10',
    },
  ],
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/alumnos/:studentId" element={<AdminStudentDetail />} />
    </Routes>,
    { route: '/admin/alumnos/7' },
  );
}

describe('AdminStudentDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not show fake $0.00 KPIs while the ledger is loading', () => {
    getStudentLedger.mockReturnValue(new Promise(() => {}) as never);

    renderPage();

    expect(screen.queryByText('Saldo de colegiaturas')).not.toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.getByText('Alumnos')).toBeInTheDocument();
  });

  it('shows ErrorState with retry instead of empty KPIs when load fails', async () => {
    getStudentLedger
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: LEDGER } as never);

    renderPage();

    expect(await screen.findByText(/No se pudo cargar la información/i)).toBeInTheDocument();
    expect(screen.queryByText('Saldo de colegiaturas')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Reintentar/i }));
    expect(await screen.findByText('Luis López')).toBeInTheDocument();
  });

  it('renders student KPIs, invoice badges, and child panels on success', async () => {
    getStudentLedger.mockResolvedValue({ data: LEDGER } as never);

    renderPage();

    expect(await screen.findByText('Luis López')).toBeInTheDocument();
    expect(screen.getByText(/Matrícula A-007 · 3° A/)).toBeInTheDocument();
    expect(screen.getByText('Saldo de colegiaturas')).toBeInTheDocument();
    expect(screen.getByText('$2500.50')).toBeInTheDocument();
    expect(screen.getByText('Agosto 2026')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText('Pagada')).toBeInTheDocument();
    expect(screen.getByTestId('student-guardians')).toHaveTextContent('7');
    expect(screen.getByTestId('student-discounts')).toHaveTextContent('7');

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Cafetería/i })).toHaveAttribute(
        'href',
        '/admin/cafeteria/7',
      );
    });
  });
});
