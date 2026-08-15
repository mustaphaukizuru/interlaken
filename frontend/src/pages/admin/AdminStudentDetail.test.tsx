import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

vi.mock('@/services/api', () => ({
  portalApi: {
    getStudent: vi.fn(),
  },
}));

vi.mock('@/components/admin/StudentGuardians', () => ({
  StudentGuardians: ({ studentId }: { studentId: number }) => (
    <div data-testid="student-guardians">{studentId}</div>
  ),
}));

import AdminStudentDetail from './AdminStudentDetail';
import { portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const getStudent = vi.mocked(portalApi.getStudent);

const STUDENT = {
  id: 7,
  user: {
    id: 70,
    email: 'luis@interlaken.test',
    first_name: 'Luis',
    last_name: 'López',
    full_name: 'Luis López',
    role: 'student',
    avatar: '',
    whatsapp: '',
  },
  student_id: 'A-007',
  grade: '3°',
  group: 'A',
  loyverse_id: 'loy-7',
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

  it('shows only the back link while the student is loading', () => {
    getStudent.mockReturnValue(new Promise(() => {}) as never);

    renderPage();

    expect(screen.queryByText('Datos del alumno')).not.toBeInTheDocument();
    expect(screen.getByText('Alumnos')).toBeInTheDocument();
  });

  it('shows ErrorState with retry when the load fails', async () => {
    getStudent
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: STUDENT } as never);

    renderPage();

    expect(await screen.findByText(/No se pudo cargar la información/i)).toBeInTheDocument();
    expect(screen.queryByText('Datos del alumno')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Reintentar/i }));
    expect(await screen.findByText('Luis López')).toBeInTheDocument();
  });

  it('renders identity, guardians and the cafetería shortcut (no tuition UI)', async () => {
    getStudent.mockResolvedValue({ data: STUDENT } as never);

    renderPage();

    expect(await screen.findByText('Luis López')).toBeInTheDocument();
    expect(screen.getByText(/Matrícula A-007 · 3° A/)).toBeInTheDocument();
    expect(screen.getByText('Datos del alumno')).toBeInTheDocument();
    expect(screen.getByText('luis@interlaken.test')).toBeInTheDocument();
    expect(screen.getByTestId('student-guardians')).toHaveTextContent('7');

    // Tuition billing is gone — no ledger, KPIs or discounts may resurface.
    expect(screen.queryByText(/colegiatura/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('student-discounts')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Cafetería/i })).toHaveAttribute(
        'href',
        '/admin/cafeteria/7',
      );
    });
  });
});
