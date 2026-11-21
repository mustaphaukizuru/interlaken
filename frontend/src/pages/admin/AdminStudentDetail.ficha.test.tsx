import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

vi.mock('@/services/api', () => ({
  portalApi: { getStudent: vi.fn(), getStudentHistory: vi.fn(), studentsBulk: vi.fn() },
  api: { get: vi.fn() },
  downloadBlob: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => 't') },
}));

import AdminStudentDetail from './AdminStudentDetail';
import { api, portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useAuthStore } from '@/store/authStore';

const getStudent = vi.mocked(portalApi.getStudent);
const get = vi.mocked(api.get);

const STUDENT = {
  id: 7,
  user: { id: 70, email: 'luis@interlaken.test', first_name: 'Luis', last_name: 'López', full_name: 'Luis López', role: 'student', avatar: '', whatsapp: '' },
  student_id: 'A-007',
  grade: '3°',
  group: 'A',
  loyverse_id: 'loy-7',
};

function openFile(student: Record<string, unknown>) {
  getStudent.mockResolvedValue({ data: student } as never);
  return renderWithProviders(
    <Routes>
      <Route path="/admin/alumnos/:studentId" element={<AdminStudentDetail />} />
    </Routes>,
    { route: '/admin/alumnos/7' },
  );
}

describe('AdminStudentDetail · Ficha de inscripción', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: new Blob(['x']), headers: {} } as never);
  });

  it('downloads the ficha of the inscripción the student came from', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ user: { id: 1, email: 'a@x.mx', role: 'admin' } as never });
    openFile({ ...STUDENT, registration: 41 });
    await user.click(await screen.findByRole('button', { name: /Ficha de inscripción/ }));
    await user.click(screen.getByRole('menuitem', { name: /PDF/ }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/admissions/register/41/ficha/export/', {
      params: { fmt: 'pdf' }, responseType: 'blob',
    }));
  });

  it('hidden without an inscripción or without the admisiones area', async () => {
    useAuthStore.setState({ user: { id: 2, email: 's@x.mx', role: 'staff', staff_areas: ['alumnos'] } as never });
    const { unmount } = openFile({ ...STUDENT, registration: 41 });
    expect(await screen.findByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ficha de inscripción/ })).toBeNull();
    unmount();

    useAuthStore.setState({ user: { id: 3, email: 'm@x.mx', role: 'staff', staff_areas: ['alumnos', 'admisiones'] } as never });
    openFile({ ...STUDENT, registration: null });
    expect(await screen.findByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ficha de inscripción/ })).toBeNull();
  });
});
