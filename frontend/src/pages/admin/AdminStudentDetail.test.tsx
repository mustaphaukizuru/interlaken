import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

vi.mock('@/services/api', () => ({
  portalApi: {
    getStudent: vi.fn(),
    getStudentHistory: vi.fn(),
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

describe('AdminStudentDetail: archiving, removing and history', () => {
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
  const respond = (outcomes: Record<string, number>) => bulk.mockImplementation(async (body) => ({
    data: { action: body.action, requested: 1, ok: 1, failed: [], skipped: [], dry_run: !!body.dry_run, outcomes },
  }) as never);

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: 1, email: 'x@x.mx', role: 'admin' } as never });
  });

  it('erasing a file with nothing to keep returns to the list', async () => {
    respond({ erased: 1 });
    const user = userEvent.setup();
    openFile();
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }));
    const dialog = await screen.findByRole('dialog', { name: /Eliminar: Luis/ });
    expect(await within(dialog).findByText(/se eliminará por completo/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Eliminar \(1\)/ }));

    expect(await screen.findByText('Listado')).toBeInTheDocument();
    expect(bulk).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'delete', ids: [7], dry_run: false, payload: { confirm: 'ELIMINAR' },
    }));
  });

  it('a file with history is archived instead, and the page stays', async () => {
    respond({ archived: 1 });
    const user = userEvent.setup();
    openFile();
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }));
    const dialog = await screen.findByRole('dialog', { name: /Eliminar/ });
    expect(await within(dialog).findByText(/se archivará porque/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Eliminar \(1\)/ }));
    await waitFor(() => expect(bulk).toHaveBeenLastCalledWith(expect.objectContaining({ dry_run: false })));
    expect(screen.queryByText('Listado')).toBeNull();
  });

  it('an archived file says so and offers Restaurar', async () => {
    respond({ restored: 1 });
    const user = userEvent.setup();
    openFile({ ...STUDENT, status: 'withdrawn', is_active: false, archived_at: '2026-11-08T10:00:00Z' });
    expect(await screen.findByText(/Archivado el/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /Restaurar/ })[0]);
    await waitFor(() => expect(bulk).toHaveBeenCalledWith({
      action: 'restore', ids: [7], all_matching: false, filters: undefined, dry_run: true,
    }));
  });

  it('does not offer the delete to staff', async () => {
    useAuthStore.setState({ user: { id: 2, email: 's@x.mx', role: 'staff', staff_areas: ['alumnos'] } as never });
    openFile();
    expect(await screen.findByRole('button', { name: 'Archivar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).toBeNull();
  });

  it('Historial lists who changed what', async () => {
    vi.mocked(portalApi.getStudentHistory).mockResolvedValue({ data: [{
      id: 1, actor: 3, actor_label: 'paola@interlaken.com.mx', action: 'update', action_display: 'Modificación',
      object_type: 'accounts.studentprofile', object_id: '7', context: 'portal: edición de alumno',
      changes: { grade: ['1° Primaria', '2° Primaria'], via: 'portal' }, created_at: '2026-11-08T16:00:00Z',
    }] } as never);
    const user = userEvent.setup();
    openFile();
    await user.click(await screen.findByRole('tab', { name: 'Historial' }));
    expect(await screen.findByText('Grado: 1° Primaria → 2° Primaria')).toBeInTheDocument();
    expect(screen.getByText(/paola@interlaken.com.mx/)).toBeInTheDocument();
  });
});
