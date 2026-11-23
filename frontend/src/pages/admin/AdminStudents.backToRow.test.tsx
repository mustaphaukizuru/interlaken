import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { loading: vi.fn(() => 't1'), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('@/services/familiesApi', () => ({ familiesApi: { link: vi.fn() } }));
vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  portalApi: {
    getStudents: vi.fn(),
    getStudent: vi.fn(),
    exportStudents: vi.fn(),
    studentsBulk: vi.fn(),
    importLoyverse: vi.fn(),
    linkLoyverse: vi.fn(),
  },
  downloadBlob: vi.fn(),
}));

import AdminStudents from './AdminStudents';
import { portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import { lastOpenedScope, peekOpened } from '@/lib/lastOpened';

const ana = {
  id: 5, student_id: '09932', loyverse_code: 'ci09932', grade: '1° Primaria', group: 'A', status: 'active', balance: '80.00',
  user: { id: 9, first_name: 'Ana', last_name: 'López', full_name: 'Ana López', email: 'ana@x.mx', last_login: null },
};
const beto = { ...ana, id: 6, student_id: '09933', loyverse_code: '09933', balance: '0.00', user: { ...ana.user, id: 10, first_name: 'Beto', full_name: 'Beto Ruiz' } };

/** The ficha route, reduced to its two ways back: the browser's Back and «Volver». */
function FichaStub() {
  const navigate = useNavigate();
  return (
    <div>
      <h1>Ficha del alumno</h1>
      <button type="button" onClick={() => navigate(-1)}>Atrás</button>
      <Link to="/admin/alumnos">Volver</Link>
    </div>
  );
}

function Console() {
  return (
    <Routes>
      <Route path="/admin/alumnos" element={<AdminStudents />} />
      <Route path="/admin/alumnos/:id" element={<FichaStub />} />
    </Routes>
  );
}

const nameLink = async (name: string) => (await screen.findAllByRole('link', { name }))[0];
const rowOf = async (name: string) => (await nameLink(name)).closest('tr') as HTMLElement;

describe('AdminStudents · back to the same row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    stubViewport(1280);
    vi.mocked(portalApi.getStudents).mockResolvedValue({ data: { count: 2, next: null, previous: null, results: [ana, beto] } } as never);
    vi.mocked(portalApi.getStudent).mockImplementation(async (id: number) =>
      ({ data: { ...(id === beto.id ? beto : ana), guardians: [], allergies: '', medical_notes: '' } }) as never);
  });
  afterEach(() => sessionStorage.clear());

  it('browser Back from a ficha points at that student, once', async () => {
    renderWithProviders(<Console />, { route: '/admin/alumnos' });
    await userEvent.click(await nameLink('Beto Ruiz'));
    expect(await screen.findByRole('heading', { name: 'Ficha del alumno' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Atrás' }));
    const beto_ = await rowOf('Beto Ruiz');
    await waitFor(() => expect(beto_).toHaveAttribute('data-last-opened', 'true'));
    expect(await rowOf('Ana López')).not.toHaveAttribute('data-last-opened');
    // Spent: the next visit to the list points at nothing.
    expect(peekOpened(lastOpenedScope('students'))).toBeNull();
  });

  it('«Volver» on the ficha points at the student too', async () => {
    renderWithProviders(<Console />, { route: '/admin/alumnos' });
    await userEvent.click(await nameLink('Ana López'));
    await userEvent.click(await screen.findByRole('link', { name: 'Volver' }));
    const ana_ = await rowOf('Ana López');
    await waitFor(() => expect(ana_).toHaveAttribute('data-last-opened', 'true'));
    expect(await rowOf('Beto Ruiz')).not.toHaveAttribute('data-last-opened');
  });

  it('closing «Editar» points at the student it edited', async () => {
    renderWithProviders(<Console />, { route: '/admin/alumnos' });
    await userEvent.click(await screen.findByRole('button', { name: 'Editar a Beto Ruiz' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector('[data-last-opened]')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    const beto_ = await rowOf('Beto Ruiz');
    await waitFor(() => expect(beto_).toHaveAttribute('data-last-opened', 'true'));
  });

  it('on 2xl screens, closing the side panel points at the student it showed', async () => {
    const mql = window.matchMedia;
    window.matchMedia = ((q: string) => ({ ...mql(q), matches: /1536|1280|1024|768/.test(q) })) as typeof window.matchMedia;
    try {
      renderWithProviders(<Console />, { route: '/admin/alumnos' });
      await userEvent.click(await nameLink('Ana López'));
      expect(await screen.findByRole('complementary', { name: 'Detalle del alumno' })).toBeInTheDocument();
      expect(document.querySelector('[data-last-opened]')).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
      const ana_ = await rowOf('Ana López');
      await waitFor(() => expect(ana_).toHaveAttribute('data-last-opened', 'true'));
    } finally {
      window.matchMedia = mql;
    }
  });
});
