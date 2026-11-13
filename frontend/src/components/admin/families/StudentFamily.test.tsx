import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  portalApi: { getStudents: vi.fn() },
}));

vi.mock('@/services/familiesApi', () => ({
  familiesApi: {
    studentFamily: vi.fn(),
    link: vi.fn(),
    removeStudent: vi.fn(),
    dissolve: vi.fn(),
    update: vi.fn(),
    suggestionsBulk: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import toast from 'react-hot-toast';
import { StudentFamily } from './StudentFamily';
import { portalApi } from '@/services/api';
import { familiesApi } from '@/services/familiesApi';
import { renderWithProviders } from '@/test/renderWithProviders';

const ana = {
  id: 1, name: 'Ana Pérez López', first_name: 'Ana', last_name: 'Pérez López', email: 'ci00001@interlaken.com.mx',
  student_id: '00001', grade: '3° Primaria', group: 'A', status: 'active', status_label: 'Activo', archived: false, family: null,
};
const luis = {
  ...ana, id: 2, name: 'Luis Pérez López', first_name: 'Luis', email: 'ci00002@interlaken.com.mx', student_id: '00002',
  grade: '1° Secundaria', group: 'B',
};
const anaLogin = {
  id: 11, email: ana.email, full_name: ana.name, kind: 'student', kind_label: 'Cuenta del alumno',
  is_active: true, last_login: null, linked_to: ['Ana'],
};
const luisLogin = { ...anaLogin, id: 12, email: luis.email, full_name: luis.name, linked_to: ['Luis'] };

const PLAN = {
  dry_run: true,
  action: 'create',
  family: null,
  name: 'Familia Pérez López',
  students_after: [ana, luis],
  adding: [ana, luis],
  merging: [],
  new_access: [
    { ...anaLogin, gains: ['Luis Pérez López'] },
    { ...luisLogin, gains: ['Ana Pérez López'] },
  ],
};

const studentFamily = vi.mocked(familiesApi.studentFamily);
const link = vi.mocked(familiesApi.link);
const getStudents = vi.mocked(portalApi.getStudents);

function rosterRow(s: typeof luis) {
  return {
    id: s.id, student_id: s.student_id, grade: s.grade, group: s.group, loyverse_id: '',
    user: { id: 99, email: s.email, first_name: s.first_name, last_name: s.last_name, full_name: s.name, role: 'student' },
    family: null, archived_at: null,
  };
}

describe('StudentFamily', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('without a family offers to link a sibling, previews the access and links', async () => {
    studentFamily.mockResolvedValue({ data: { student: ana, family: null, logins: [anaLogin], suggestions: [] } } as never);
    getStudents.mockResolvedValue({ data: { count: 1, results: [rosterRow(luis)] } } as never);
    link.mockImplementation(async (body) => ({
      data: body.dry_run ? PLAN : { ...PLAN, dry_run: false, result: { id: 5, name: 'Familia Pérez López', notes: '', created_at: null, created_by: '', students: [ana, luis], logins: [anaLogin, luisLogin] } },
    }) as never);

    renderWithProviders(<StudentFamily studentId={1} />);

    expect(await screen.findByText('Sin hermanos vinculados')).toBeInTheDocument();
    expect(screen.getByText(ana.email)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Vincular hermano/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Vincular hermano' });
    // Nothing is looked up before two letters.
    expect(within(dialog).getByRole('button', { name: /Revisar \(0\)/ })).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Buscar alumno'), 'luis');
    const result = await within(dialog).findByRole('button', { name: /Luis Pérez López/ });
    await waitFor(() => expect(getStudents).toHaveBeenCalledWith(expect.objectContaining({ q: 'luis', page_size: 8 })));
    await userEvent.click(result);
    expect(result).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(within(dialog).getByRole('button', { name: /Revisar \(1\)/ }));
    // The dry run names who will see whom before anything changes.
    expect(await within(dialog).findByText('Se creará una familia nueva')).toBeInTheDocument();
    expect(link).toHaveBeenCalledWith({ student_ids: [1, 2], family: undefined, dry_run: true });
    expect(within(dialog).getByText(/verá a Luis Pérez López/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Nombre de la familia')).toHaveValue('Familia Pérez López');
    expect(within(dialog).getByRole('checkbox', { name: /Avisar a la familia/ })).toBeChecked();

    await userEvent.click(within(dialog).getByRole('button', { name: /Crear familia/ }));
    await waitFor(() => expect(link).toHaveBeenLastCalledWith({ student_ids: [1, 2], family: undefined, name: undefined, notify: true }));
    expect(toast.success).toHaveBeenCalledWith('Familia creada: Familia Pérez López.');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('can rename before linking and skip the notice', async () => {
    studentFamily.mockResolvedValue({ data: { student: ana, family: null, logins: [anaLogin], suggestions: [] } } as never);
    getStudents.mockResolvedValue({ data: { count: 1, results: [rosterRow(luis)] } } as never);
    link.mockResolvedValue({ data: PLAN } as never);

    renderWithProviders(<StudentFamily studentId={1} />);
    await userEvent.click(await screen.findByRole('button', { name: /Vincular hermano/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Buscar alumno'), 'lu');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Luis Pérez López/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: /Revisar/ }));
    const nameInput = await within(dialog).findByLabelText('Nombre de la familia');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Familia Pérez');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Avisar a la familia/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: /Crear familia/ }));
    await waitFor(() => expect(link).toHaveBeenLastCalledWith({ student_ids: [1, 2], family: undefined, name: 'Familia Pérez', notify: false }));
  });

  it('shows the dry-run refusal and lets the person go back', async () => {
    studentFamily.mockResolvedValue({ data: { student: ana, family: null, logins: [anaLogin], suggestions: [] } } as never);
    getStudents.mockResolvedValue({ data: { count: 1, results: [rosterRow(luis)] } } as never);
    link.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { detail: 'Una familia admite hasta 10 alumnos; quedaría con 11.' } } });

    renderWithProviders(<StudentFamily studentId={1} />);
    await userEvent.click(await screen.findByRole('button', { name: /Vincular hermano/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Buscar alumno'), 'lu');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Luis Pérez López/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: /Revisar/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('admite hasta 10');
    await userEvent.click(within(dialog).getByRole('button', { name: /Atrás/ }));
    expect(within(dialog).getByLabelText('Buscar alumno')).toBeInTheDocument();
  });

  it('with a family lists siblings and accounts, and removes one after confirming', async () => {
    const family = {
      id: 5, name: 'Familia Pérez López', notes: '', created_at: null, created_by: '',
      students: [{ ...ana, family: { id: 5, name: 'Familia Pérez López' } }, { ...luis, family: { id: 5, name: 'Familia Pérez López' } }],
      logins: [anaLogin, luisLogin],
    };
    studentFamily.mockResolvedValue({ data: { student: family.students[0], family, logins: family.logins, suggestions: [] } } as never);
    vi.mocked(familiesApi.removeStudent).mockResolvedValue({ data: { dissolved: true } } as never);

    renderWithProviders(<StudentFamily studentId={1} />);

    expect(await screen.findByText('Familia Pérez López')).toBeInTheDocument();
    expect(screen.getByText('2 hermanos · 2 cuentas con acceso')).toBeInTheDocument();
    expect(screen.getByText('Este alumno')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Luis Pérez López' })).toHaveAttribute('href', '/admin/alumnos/2');
    expect(screen.getByText(luis.email)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Quitar a Luis Pérez López de la familia' }));
    const confirm = await screen.findByRole('dialog', { name: 'Quitar de la familia' });
    expect(confirm).toHaveTextContent('la familia se disuelve');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Quitar' }));
    await waitFor(() => expect(familiesApi.removeStudent).toHaveBeenCalledWith(5, 2));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Familia disuelta'));
  });

  it('shows suggestions and dismisses one', async () => {
    const suggestion = {
      key: '1-2', confidence: 'alta', students: [ana, luis], families: [],
      reasons: [{ kind: 'phone', label: 'Mismo teléfono', value: '55 1234 5678' }],
    };
    studentFamily.mockResolvedValue({ data: { student: ana, family: null, logins: [anaLogin], suggestions: [suggestion] } } as never);
    vi.mocked(familiesApi.suggestionsBulk).mockResolvedValue({ data: { action: 'dismiss', requested: 1, ok: 1, failed: [], skipped: [], dry_run: false } } as never);

    renderWithProviders(<StudentFamily studentId={1} />);

    expect(await screen.findByText('Posibles hermanos')).toBeInTheDocument();
    expect(screen.getByText('Mismo teléfono:')).toBeInTheDocument();
    expect(screen.getByText('Confianza alta')).toBeInTheDocument();
    // Only the other student is named, never the file's own.
    expect(screen.getByText('Luis Pérez López')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'No son hermanos' }));
    await waitFor(() => expect(familiesApi.suggestionsBulk).toHaveBeenCalledWith({ action: 'dismiss', ids: ['1-2'] }));
    expect(toast.success).toHaveBeenCalledWith('Sugerencia descartada: no se volverá a mostrar.');
  });

  it('opens the review directly from a suggestion', async () => {
    const suggestion = { key: '1-2', confidence: 'media', students: [ana, luis], families: [], reasons: [] };
    studentFamily.mockResolvedValue({ data: { student: ana, family: null, logins: [anaLogin], suggestions: [suggestion] } } as never);
    link.mockResolvedValue({ data: PLAN } as never);

    renderWithProviders(<StudentFamily studentId={1} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Revisar y vincular' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Se creará una familia nueva')).toBeInTheDocument();
    expect(link).toHaveBeenCalledWith({ student_ids: [1, 2], family: undefined, dry_run: true });
    // Straight to the review: no way «Atrás» to an empty picker.
    expect(within(dialog).queryByRole('button', { name: /Atrás/ })).not.toBeInTheDocument();
  });
});
