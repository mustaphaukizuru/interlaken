import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

vi.mock('@/services/api', () => ({
  portalApi: {
    getStudent: vi.fn(),
    studentsBulk: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/components/admin/StudentGuardians', () => ({
  StudentGuardians: ({ studentId }: { studentId: number }) => (
    <div data-testid="student-guardians">{studentId}</div>
  ),
}));

import AdminStudentDetail from './AdminStudentDetail';
import { portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useAuthStore } from '@/store/authStore';

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
    expect(await screen.findByRole('heading', { name: 'Luis López' })).toBeInTheDocument();
  });

  it('renders identity, guardians and the cafetería shortcut (no tuition UI)', async () => {
    getStudent.mockResolvedValue({ data: STUDENT } as never);

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Luis López' })).toBeInTheDocument();
    expect(screen.getByText(/Matrícula A-007 · 3° A/)).toBeInTheDocument();
    expect(screen.getByText('Datos del alumno')).toBeInTheDocument();
    expect(screen.getByText('luis@interlaken.test')).toBeInTheDocument();
    // Guardians live on their own tab now (P1-A2).
    await userEvent.click(screen.getByRole('tab', { name: /Tutores/i }));
    expect(screen.getByTestId('student-guardians')).toHaveTextContent('7');
    await userEvent.click(screen.getByRole('tab', { name: /Datos/i }));

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

describe('AdminStudentDetail: archiving and removing', () => {
  const bulk = vi.mocked(portalApi.studentsBulk);
  const openFile = (student: unknown = STUDENT) => {
    getStudent.mockResolvedValue({ data: student } as never);
    return renderWithProviders(
      <Routes>
        <Route path="/admin/alumnos/:studentId" element={<AdminStudentDetail />} />
        <Route path="/admin/alumnos" element={<div>Listado</div>} />
      </Routes>,
      { route: '/admin/alumnos/7' },
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: 1, email: 'x@x.mx', role: 'admin' } as never });
    bulk.mockImplementation(async (body) => ({
      data: { action: body.action, requested: 1, ok: 1, failed: [], skipped: [], dry_run: !!body.dry_run },
    }) as never);
  });

  it('deletes after the typed confirmation and returns to the list', async () => {
    const user = userEvent.setup();
    openFile();
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }));
    const dialog = await screen.findByRole('dialog', { name: /Eliminar definitivamente: Luis/ });
    await user.type(await within(dialog).findByLabelText(/Escriba ELIMINAR/), 'ELIMINAR');
    await user.click(within(dialog).getByRole('button', { name: /Eliminar definitivamente \(1\)/ }));

    expect(await screen.findByText('Listado')).toBeInTheDocument();
    expect(bulk).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'delete', ids: [7], dry_run: false, payload: { confirm: 'ELIMINAR' },
    }));
  });

  it('stays on the file when the server refuses, with the reason on screen', async () => {
    bulk.mockImplementation(async (body) => ({
      data: {
        action: body.action, requested: 1, ok: 0, failed: [], dry_run: !!body.dry_run,
        skipped: [{ id: 7, reason: 'ya inició sesión en el portal' }],
      },
    }) as never);
    const user = userEvent.setup();
    openFile();
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }));
    const dialog = await screen.findByRole('dialog', { name: /Eliminar definitivamente/ });

    expect(await within(dialog).findByText(/1 porque ya inició sesión en el portal/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Escriba ELIMINAR/)).toBeNull();
    expect(within(dialog).getByRole('button', { name: /Eliminar definitivamente \(0\)/ })).toBeDisabled();
  });

  it('offers Dar de baja to an active student and Reactivar to an archived one', async () => {
    const user = userEvent.setup();
    openFile({ ...STUDENT, status: 'withdrawn', is_active: false });
    await user.click(await screen.findByRole('button', { name: 'Reactivar' }));
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).toBeNull();
    await waitFor(() => expect(bulk).toHaveBeenCalledWith({
      action: 'status', ids: [7], all_matching: false, filters: undefined, payload: { value: 'active' }, dry_run: true,
    }));
  });

  it('does not offer the delete to staff', async () => {
    useAuthStore.setState({ user: { id: 2, email: 's@x.mx', role: 'staff', staff_areas: ['alumnos'] } as never });
    openFile();
    expect(await screen.findByRole('button', { name: 'Dar de baja' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).toBeNull();
  });
});
